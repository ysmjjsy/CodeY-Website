package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

// userChannelProtection is the SSRF policy of user-owned channels. It never
// reads the global fetch setting: an operator who allows private addresses for
// platform channels must not widen what a seller can reach. Ports come from the
// marketplace setting on every check so changes apply without rebuilding the
// client.
func userChannelProtection() *common.SSRFProtection {
	return &common.SSRFProtection{
		AllowPrivateIp:         false,
		DomainFilterMode:       false,
		IpFilterMode:           false,
		AllowedPorts:           token_package_setting.AllowedSellerChannelPorts(),
		ApplyIPFilterForDomain: true,
	}
}

// ValidateUserChannelBaseURL rejects a seller-supplied base URL that points at
// a private address or a port outside the marketplace allowlist. The lookup
// here is a first gate only; the dial-time check in the channel client is what
// blocks DNS rebinding between the save and the request.
func ValidateUserChannelBaseURL(rawURL string) error {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil
	}
	return userChannelProtection().ValidateURL(trimmed)
}

type userChannelRoundTripper struct {
	transport *http.Transport
}

func (t *userChannelRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil || req.URL == nil {
		return nil, fmt.Errorf("invalid request")
	}
	if err := userChannelProtection().ValidateURL(req.URL.String()); err != nil {
		return nil, err
	}
	return t.transport.RoundTrip(req)
}

func (t *userChannelRoundTripper) CloseIdleConnections() {
	t.transport.CloseIdleConnections()
}

func newUserChannelHTTPClient() *http.Client {
	protectedDialer := &protectedFetchDialer{
		resolver:    net.DefaultResolver,
		dialContext: (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		getProtection: func() (*common.SSRFProtection, bool, error) {
			return userChannelProtection(), true, nil
		},
	}
	// Same pool, idle, header-wait and HTTP/2 ping settings as the relay
	// client, but never an environment proxy, and every dial is checked.
	transport := newRelayHTTPTransport()
	transport.Proxy = nil
	transport.DialContext = protectedDialer.DialContext
	transport.DialTLSContext = nil
	client := &http.Client{
		Transport: &userChannelRoundTripper{transport: transport},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if err := userChannelProtection().ValidateURL(req.URL.String()); err != nil {
				return fmt.Errorf("redirect to %s blocked: %v", req.URL.String(), err)
			}
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			return nil
		},
	}
	if common.RelayTimeout != 0 {
		client.Timeout = time.Duration(common.RelayTimeout) * time.Second
	}
	return client
}

// The client is built on first use, not at package init: its transport reads
// the relay settings, which are loaded from the environment after init.
var (
	userChannelHTTPClient     *http.Client
	userChannelHTTPClientOnce sync.Once
)

// GetUserChannelHTTPClient returns the client used for channels owned by
// users. The relay client has no SSRF guard on purpose (operator-managed base
// URLs), so every request through this client is validated against the fixed
// marketplace policy, at request time and again at dial time.
func GetUserChannelHTTPClient() *http.Client {
	userChannelHTTPClientOnce.Do(func() {
		userChannelHTTPClient = newUserChannelHTTPClient()
	})
	return userChannelHTTPClient
}

// UserChannelWebSocketDialer is the dial function for a WebSocket opened to a
// seller-supplied upstream. It reuses the marketplace SSRF policy: the resolved
// address is checked at dial time, so a DNS answer that flips to a private
// address between the channel save and the connection is still refused, and it
// ignores the process proxy environment so the connection cannot be steered
// through an operator-configured proxy.
func UserChannelWebSocketDialer(ctx context.Context, network, address string) (net.Conn, error) {
	protection := userChannelProtection()
	dialer := &protectedFetchDialer{
		resolver:    net.DefaultResolver,
		dialContext: (&net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		getProtection: func() (*common.SSRFProtection, bool, error) {
			return protection, true, nil
		},
	}
	return dialer.DialContext(ctx, network, address)
}
