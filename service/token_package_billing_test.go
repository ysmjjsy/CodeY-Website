package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	tpkgdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPackageRequestNeverTouchesTheWallet(t *testing.T) {
	setupPackagePricingTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}))

	buyer := &model.User{Username: "buyer", AffCode: "buyer-aff", Quota: 500000, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(buyer).Error)
	pkg := createPricingPackage(t, 1)
	entitlement := &model.TokenPackageEntitlement{
		UserId:      buyer.Id,
		PackageId:   pkg.Id,
		VersionId:   pkg.ActiveVersionId,
		BillingMode: constant.TokenPackageBillingModeQuota,
		AmountTotal: 1000,
		PaidQuota:   1000,
		StartTime:   common.GetTimestamp() - 10,
		EndTime:     common.GetTimestamp() + 3600,
		Status:      constant.TokenPackageEntitlementStatusActive,
	}
	require.NoError(t, entitlement.SetModelSpecs([]tpkgdto.TokenPackageModelSpec{{Model: "gpt-test", Multiplier: 1}}))
	require.NoError(t, model.DB.Create(entitlement).Error)

	walletBefore := buyer.Quota
	funding := &PackageFunding{userId: buyer.Id, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-wallet"}
	require.NoError(t, funding.PreConsume(400))
	require.NoError(t, funding.Settle(-100))

	var stored model.User
	require.NoError(t, model.DB.First(&stored, buyer.Id).Error)
	assert.Equal(t, walletBefore, stored.Quota, "pre-consume and settlement move package quota only")

	var storedEntitlement model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&storedEntitlement, entitlement.Id).Error)
	assert.Equal(t, int64(300), storedEntitlement.AmountUsed)
}

func TestPackageRequestIsRefusedByWalletSettlement(t *testing.T) {
	_, err := postConsumeQuotaWithResult(&relaycommon.RelayInfo{
		UserId:        7,
		PackageId:     3,
		BillingSource: BillingSourcePackage,
	}, 100, 0, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "package entitlement")
}

func TestPreConsumeRefusesMoreThanTheEntitlementHasLeft(t *testing.T) {
	setupPackagePricingTest(t)

	pkg := createPricingPackage(t, 1)
	entitlement := &model.TokenPackageEntitlement{
		UserId:      1,
		PackageId:   pkg.Id,
		BillingMode: constant.TokenPackageBillingModeQuota,
		AmountTotal: 100,
		AmountUsed:  90,
		StartTime:   common.GetTimestamp() - 10,
		EndTime:     common.GetTimestamp() + 3600,
		Status:      constant.TokenPackageEntitlementStatusActive,
	}
	require.NoError(t, model.DB.Create(entitlement).Error)

	err := model.PreConsumePackageEntitlement(entitlement.Id, "req-over", 50)
	assert.ErrorIs(t, err, model.ErrTokenPackageEntitlementMissing, "a reservation larger than the remainder is refused")

	var stored model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&stored, entitlement.Id).Error)
	assert.Equal(t, int64(90), stored.AmountUsed, "a refused reservation changes nothing")
}

func TestPackageSessionGrowsItsReservationWithinTheEntitlement(t *testing.T) {
	setupPackagePricingTest(t)

	pkg := createPricingPackage(t, 1)
	entitlement := &model.TokenPackageEntitlement{
		UserId:      1,
		PackageId:   pkg.Id,
		BillingMode: constant.TokenPackageBillingModeQuota,
		AmountTotal: 1000,
		StartTime:   common.GetTimestamp() - 10,
		EndTime:     common.GetTimestamp() + 3600,
		Status:      constant.TokenPackageEntitlementStatusActive,
	}
	require.NoError(t, model.DB.Create(entitlement).Error)
	usedAmount := func() int64 {
		var stored model.TokenPackageEntitlement
		require.NoError(t, model.DB.First(&stored, entitlement.Id).Error)
		return stored.AmountUsed
	}

	// The same path an image batch takes: the first estimate is reserved, then
	// a larger one is reserved before the request is sent.
	funding := &PackageFunding{userId: 1, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-top-up"}
	require.NoError(t, funding.PreConsume(200))
	session := &BillingSession{
		relayInfo:        &relaycommon.RelayInfo{UserId: 1, PackageId: pkg.Id, IsPlayground: true},
		funding:          funding,
		preConsumedQuota: 200,
	}
	require.NoError(t, session.ReserveBeforeSubmit(500))
	assert.Equal(t, int64(500), usedAmount(), "the second reservation grows the same record")

	err := session.ReserveBeforeSubmit(1200)
	require.Error(t, err, "a reservation larger than the remaining credit is refused")
	var apiErr *types.NewAPIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, types.ErrorCodeInsufficientPackageQuota, apiErr.GetErrorCode())
	assert.Equal(t, int64(500), usedAmount(), "a refused reservation changes nothing")

	require.NoError(t, session.Settle(450))
	assert.Equal(t, int64(450), usedAmount(), "settlement applies the difference to the grown reservation")
}

func TestPackageRefundReturnsEveryReservationOfTheRequest(t *testing.T) {
	setupPackagePricingTest(t)

	pkg := createPricingPackage(t, 1)
	entitlement := &model.TokenPackageEntitlement{
		UserId:      1,
		PackageId:   pkg.Id,
		BillingMode: constant.TokenPackageBillingModeQuota,
		AmountTotal: 1000,
		StartTime:   common.GetTimestamp() - 10,
		EndTime:     common.GetTimestamp() + 3600,
		Status:      constant.TokenPackageEntitlementStatusActive,
	}
	require.NoError(t, model.DB.Create(entitlement).Error)

	funding := &PackageFunding{userId: 1, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-refund"}
	require.NoError(t, funding.PreConsume(200))
	require.NoError(t, funding.PreConsume(300))
	require.NoError(t, funding.Refund())

	var stored model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&stored, entitlement.Id).Error)
	assert.Zero(t, stored.AmountUsed, "a failed request returns both reservations")
}

func TestRealtimeIsUnsupportedForPackages(t *testing.T) {
	assert.True(t, IsPackageUnsupportedRequestPath("/v1/realtime"))
	assert.True(t, IsPackageUnsupportedRequestPath("/v1/realtime/sessions"))
	assert.False(t, IsPackageUnsupportedRequestPath("/v1/chat/completions"))
}

func newPackageRequestContext(userId int) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	common.SetContextKey(c, constant.ContextKeyUserId, userId)
	return c
}

func TestPackageRequestGateStoresTheEntitlementPricing(t *testing.T) {
	setupPackagePricingTest(t)
	pkg := createPricingPackage(t, 1)
	entitlement := createPricingEntitlement(t, 5, pkg.Id, pkg.ActiveVersionId, 0.6, 1000)

	c := newPackageRequestContext(5)
	require.Nil(t, ApplyPackageRequestGate(c, pkg.Id, "gpt-test"))
	multiplier, ok := common.GetContextKeyType[float64](c, constant.ContextKeyPackageMultiplier)
	require.True(t, ok)
	assert.Equal(t, 0.6, multiplier, "the buyer's snapshot multiplier prices the request")
	assert.Equal(t, entitlement.Id, common.GetContextKeyInt(c, constant.ContextKeyPackageEntitlementId))

	apiErr := ApplyPackageRequestGate(newPackageRequestContext(5), pkg.Id, "other-model")
	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodePackageModelForbidden, apiErr.GetErrorCode())
}

func TestPackageBillingRefusesARequestThatSkippedTheGate(t *testing.T) {
	setupPackagePricingTest(t)
	pkg := createPricingPackage(t, 1)
	entitlement := createPricingEntitlement(t, 5, pkg.Id, pkg.ActiveVersionId, 0.6, 1000)

	c := newPackageRequestContext(5)
	session, apiErr := NewBillingSession(c, &relaycommon.RelayInfo{UserId: 5, PackageId: pkg.Id, RequestId: "req-no-gate", IsPlayground: true}, 100)
	assert.Nil(t, session)
	require.NotNil(t, apiErr, "billing at the platform price is never the fallback")
	assert.Equal(t, types.ErrorCodePackageUnavailable, apiErr.GetErrorCode())

	var stored model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&stored, entitlement.Id).Error)
	assert.Zero(t, stored.AmountUsed)
}

func TestPackageViolationFeeSettlesTheReservationOnce(t *testing.T) {
	setupPackagePricingTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Log{}))
	previousLogDB := model.LOG_DB
	model.LOG_DB = model.DB
	t.Cleanup(func() { model.LOG_DB = previousLogDB })
	pkg := createPricingPackage(t, 1)
	entitlement := createPricingEntitlement(t, 5, pkg.Id, pkg.ActiveVersionId, 1, 100000)

	funding := &PackageFunding{userId: 5, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-violation"}
	require.NoError(t, funding.PreConsume(40000))
	info := &relaycommon.RelayInfo{UserId: 5, PackageId: pkg.Id, IsPlayground: true, StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{}}
	info.PriceData.GroupRatioInfo.GroupRatio = 1
	session := &BillingSession{relayInfo: info, funding: funding, preConsumedQuota: 40000}
	info.Billing = session
	apiErr := types.NewErrorWithStatusCode(errors.New("blocked"), types.ErrorCodeViolationFeeGrokCSAM, http.StatusBadRequest)
	feeQuota, _, _, ok := violationFeeFor(info, apiErr)
	require.True(t, ok, "the default Grok policy charges this error")

	c := newPackageRequestContext(5)
	require.True(t, SettlePackageViolationFee(c, info, apiErr))
	// The failure path refunds afterwards; a settled session ignores it.
	session.Refund(c)

	var stored model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&stored, entitlement.Id).Error)
	assert.Equal(t, int64(feeQuota), stored.AmountUsed, "the request is charged the fee exactly once, not the reservation plus the fee")
	assert.False(t, ChargeViolationFeeIfNeeded(c, info, apiErr), "a package request never reaches the wallet fee path")
}
