package controller

// Live end-to-end Epay callback verification: a real *httptest.Server* in
// front of the production Gin handlers (EpayNotify, SubscriptionEpayNotify,
// SubscriptionEpayReturn), with freshly generated RSA key material. Unlike the
// in-process assertions, every callback here crosses a real TCP socket and a
// real HTTP request/response, matching how the gateway receives production
// webhooks.
//
// model.DB is nil throughout, so any settlement attempt fails the test via a
// panic or a "fail" body — a green run proves signature verification is the
// gate, not the database.

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func epayRSAKeys(t *testing.T) (privB64, pubB64 string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	priv, err := x509.MarshalPKCS8PrivateKey(key)
	require.NoError(t, err)
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	require.NoError(t, err)
	return base64.StdEncoding.EncodeToString(priv), base64.StdEncoding.EncodeToString(pub)
}

// runLiveEpay serves the three real handlers over HTTP and drives a matrix of
// signed/tampered/forged callbacks for one signature scheme.
func runLiveEpay(t *testing.T, signType string, setup func(ps *operation_setting.PaymentSetting), buildSigned func(t *testing.T, fields map[string]string) map[string]string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	// --- snapshot & restore all mutable global state ---
	ps := operation_setting.GetPaymentSetting()
	origPayAddr, origID, origKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	origST, origMPK, origPPK := ps.EpaySignType, ps.EpayMerchantPrivateKey, ps.EpayPlatformPublicKey
	origPM := operation_setting.PayMethods
	origDB := model.DB
	origCompliance, origVer := ps.ComplianceConfirmed, ps.ComplianceTermsVersion
	t.Cleanup(func() {
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = origPayAddr, origID, origKey
		ps.EpaySignType, ps.EpayMerchantPrivateKey, ps.EpayPlatformPublicKey = origST, origMPK, origPPK
		operation_setting.PayMethods = origPM
		model.DB = origDB
		ps.ComplianceConfirmed, ps.ComplianceTermsVersion = origCompliance, origVer
	})

	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "epay_id"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}}
	ps.ComplianceConfirmed = true
	ps.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	model.DB = nil
	setup(ps)
	require.True(t, isEpayWebhookEnabled(), "epay webhook must be configured for %s", signType)

	router := gin.New()
	router.Any("/api/user/epay/notify", EpayNotify)
	router.Any("/api/subscription/epay/notify", SubscriptionEpayNotify)
	router.Any("/api/subscription/epay/return", SubscriptionEpayReturn)
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	fields := map[string]string{
		"money": "1.00", "name": "item", "out_trade_no": "order",
		"pid": "epay_id", "trade_status": "WAIT_BUYER_PAY", "type": "alipay",
	}
	valid := buildSigned(t, fields)

	tampered := map[string]string{}
	for k, v := range valid {
		tampered[k] = v
	}
	tampered["money"] = "0.01" // signed content changed; signature now invalid

	unsigned := map[string]string{}
	for k, v := range valid {
		unsigned[k] = v
	}
	delete(unsigned, "sign")

	fakePaid := map[string]string{
		"money": "99999.00", "name": "item", "out_trade_no": "order",
		"pid": "epay_id", "trade_status": epay.StatusTradeSuccess, "type": "alipay",
		"sign": "deadbeef", "sign_type": signType,
	}

	cases := []struct {
		name       string
		params     map[string]string
		wantNotify string
		wantSubNtf string
		wantSubRet string
	}{
		{"valid_pending", valid, "success", "fail", "pending"},
		{"tampered_amount", tampered, "fail", "fail", "fail"},
		{"missing_signature", unsigned, "fail", "fail", "fail"},
		{"forged_success", fakePaid, "fail", "fail", "fail"},
	}

	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}

	call := func(method, path string, params map[string]string) (int, string, string) {
		q := url.Values{}
		for k, v := range params {
			q.Set(k, v)
		}
		var req *http.Request
		var err error
		if method == http.MethodPost {
			req, err = http.NewRequest(method, srv.URL+path, strings.NewReader(q.Encode()))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		} else {
			req, err = http.NewRequest(method, srv.URL+path+"?"+q.Encode(), nil)
			require.NoError(t, err)
		}
		resp, err := client.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, strings.TrimSpace(string(body)), resp.Header.Get("Location")
	}

	for _, tc := range cases {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			t.Run(signType+"/"+tc.name+"/"+method, func(t *testing.T) {
				code, body, _ := call(method, "/api/user/epay/notify", tc.params)
				assert.Equal(t, http.StatusOK, code)
				assert.Equal(t, tc.wantNotify, body)

				code, body, _ = call(method, "/api/subscription/epay/notify", tc.params)
				assert.Equal(t, http.StatusOK, code)
				assert.Equal(t, tc.wantSubNtf, body)

				code, _, loc := call(method, "/api/subscription/epay/return", tc.params)
				assert.Equal(t, http.StatusFound, code)
				assert.True(t, strings.HasSuffix(loc, "pay="+tc.wantSubRet), "subscription return redirect got %q", loc)
			})
		}
	}
}

// MD5 end-to-end: a callback signed with the MD5 merchant key round-trips
// through the live server; tampered/forged/unsigned callbacks are rejected.
func TestLiveEpayMD5CallbackEndToEnd(t *testing.T) {
	operation_setting.EpayKey = "live-md5-key-xyz"
	runLiveEpay(t, epay.SignTypeMD5, func(ps *operation_setting.PaymentSetting) {
		ps.EpaySignType = operation_setting.EpaySignTypeMD5
	}, func(t *testing.T, fields map[string]string) map[string]string {
		c, err := epay.NewClient(&epay.Config{PartnerID: "epay_id", Key: "live-md5-key-xyz"}, "https://pay.example.com")
		require.NoError(t, err)
		signed, err := c.SignParams(fields)
		require.NoError(t, err)
		return signed
	})
}

// RSA end-to-end: merchant signs orders with its private key; the platform
// signs callbacks with its own private key; the gateway verifies with the
// platform public key. Forged/mismatched-key callbacks are rejected.
func TestLiveEpayRSACallbackEndToEnd(t *testing.T) {
	merchantPriv, merchantPub := epayRSAKeys(t)
	platformPriv, platformPub := epayRSAKeys(t)

	runLiveEpay(t, epay.SignTypeRSA, func(ps *operation_setting.PaymentSetting) {
		ps.EpaySignType = operation_setting.EpaySignTypeRSA
		ps.EpayMerchantPrivateKey = merchantPriv
		ps.EpayPlatformPublicKey = platformPub
		// A leftover MD5 key must not weaken RSA mode.
		operation_setting.EpayKey = "stale-md5-key"
	}, func(t *testing.T, fields map[string]string) map[string]string {
		platform, err := epay.NewClient(&epay.Config{
			PartnerID: "epay_id", SignType: epay.SignTypeRSA,
			MerchantPrivateKey: platformPriv, PlatformPublicKey: merchantPub,
		}, "https://pay.example.com")
		require.NoError(t, err)
		signed, err := platform.SignParams(fields)
		require.NoError(t, err)
		return signed
	})
}
