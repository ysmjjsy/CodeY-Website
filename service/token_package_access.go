package service

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

const tokenPackageEntitlementCacheTTL = 30 * time.Second

type tokenPackageEntitlementCacheEntry struct {
	active    bool
	expiresAt time.Time
}

type tokenPackageEntitlementCacheKey struct {
	userId    int
	packageId int
}

var (
	tokenPackageEntitlementCacheLock sync.RWMutex
	tokenPackageEntitlementCache     = make(map[tokenPackageEntitlementCacheKey]tokenPackageEntitlementCacheEntry)
)

// UserHasActivePackageEntitlement answers whether a package token may
// authenticate. It is a short-TTL cache because token auth runs on every
// request; the authoritative remaining-credit check happens at pre-consume.
func UserHasActivePackageEntitlement(userId, packageId int) (bool, error) {
	if userId <= 0 || packageId <= 0 {
		return false, nil
	}
	key := tokenPackageEntitlementCacheKey{userId: userId, packageId: packageId}
	now := time.Now()
	tokenPackageEntitlementCacheLock.RLock()
	entry, cached := tokenPackageEntitlementCache[key]
	tokenPackageEntitlementCacheLock.RUnlock()
	if cached && now.Before(entry.expiresAt) {
		return entry.active, nil
	}
	active, err := model.HasActivePackageEntitlement(userId, packageId)
	if err != nil {
		return false, err
	}
	tokenPackageEntitlementCacheLock.Lock()
	tokenPackageEntitlementCache[key] = tokenPackageEntitlementCacheEntry{active: active, expiresAt: now.Add(tokenPackageEntitlementCacheTTL)}
	tokenPackageEntitlementCacheLock.Unlock()
	return active, nil
}

// InvalidatePackageEntitlementCache drops one buyer/package pair after a
// purchase or a refund so the next request sees the new state immediately.
func InvalidatePackageEntitlementCache(userId, packageId int) {
	tokenPackageEntitlementCacheLock.Lock()
	delete(tokenPackageEntitlementCache, tokenPackageEntitlementCacheKey{userId: userId, packageId: packageId})
	tokenPackageEntitlementCacheLock.Unlock()
}

// TokenPackageModelNames returns the model set of the package's current
// approved version. A package without an approved version serves nothing.
func TokenPackageModelNames(pkg *model.TokenPackage) (map[string]struct{}, error) {
	names := make(map[string]struct{})
	version, err := model.GetApprovedTokenPackageVersion(pkg)
	if err != nil || version == nil {
		return names, err
	}
	for _, spec := range version.GetModelSpecs() {
		names[spec.Model] = struct{}{}
	}
	return names, nil
}

// IsPackageUnsupportedRequestPath reports request shapes P0 packages do not
// serve. That covers asynchronous task APIs, whose settlement must persist an
// entitlement id rather than an HTTP response, and the Realtime WebSocket API:
// its usage is charged after the fact by a path that only knows wallet and
// subscription funding, so admitting it would bill the buyer's wallet (D6).
func IsPackageUnsupportedRequestPath(path string) bool {
	if path == "" {
		return false
	}
	if path == "/mj" || strings.HasPrefix(path, "/mj/") || strings.Contains(path, "/mj/") {
		return true
	}
	if path == "/v1/realtime" || strings.HasPrefix(path, "/v1/realtime/") {
		return true
	}
	if strings.HasPrefix(path, "/v1/tasks") {
		return true
	}
	for _, prefix := range []string{"/v1/video", "/v1/videos", "/suno", "/kling", "/jimeng", "/vidu"} {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}
	return false
}

// PackageAllowsModel reports whether the package's current approved version
// lists the requested model. Channel-level model mapping is applied later, in
// the routing layer.
func PackageAllowsModel(packageId int, modelName string) (bool, error) {
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		return false, err
	}
	allowed, err := TokenPackageModelNames(pkg)
	if err != nil {
		return false, err
	}
	if _, ok := allowed[modelName]; ok {
		return true, nil
	}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
		_, ok := allowed[normalized]
		return ok, nil
	}
	return false, nil
}

// ErrPackageQuotaExhausted means the buyer holds no entitlement in this package
// with quota left. Package requests never fall back to wallet or group billing.
var ErrPackageQuotaExhausted = errors.New("the token package has no quota left")

// PackagePricing carries the immutable facts a package request prices with.
type PackagePricing struct {
	EntitlementID int
	Multiplier    float64
	SellerUserID  int
}

type cachedPackageModels struct {
	models    map[string]float64
	expiresAt time.Time
}

var (
	packageModelsCacheMu sync.RWMutex
	packageModelsCache   = make(map[int]cachedPackageModels)
)

const packageModelsCacheTTL = 60 * time.Second

func packageModelMultipliers(packageId int) (map[string]float64, error) {
	packageModelsCacheMu.RLock()
	cached, ok := packageModelsCache[packageId]
	packageModelsCacheMu.RUnlock()
	if ok && time.Now().Before(cached.expiresAt) {
		return cached.models, nil
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		return nil, err
	}
	version, err := model.GetApprovedTokenPackageVersion(pkg)
	if err != nil {
		return nil, err
	}
	specs := version.GetModelSpecs()
	models := make(map[string]float64, len(specs))
	for _, spec := range specs {
		models[spec.Model] = spec.Multiplier
	}
	packageModelsCacheMu.Lock()
	packageModelsCache[packageId] = cachedPackageModels{models: models, expiresAt: time.Now().Add(packageModelsCacheTTL)}
	packageModelsCacheMu.Unlock()
	return models, nil
}

// InvalidatePackagePricingCache drops the cached multipliers after a version is
// approved or the package stops serving.
func InvalidatePackagePricingCache(packageId int) {
	packageModelsCacheMu.Lock()
	delete(packageModelsCache, packageId)
	packageModelsCacheMu.Unlock()
}

func lookupModelMultiplier(models map[string]float64, modelName string) (float64, bool) {
	if multiplier, ok := models[modelName]; ok {
		return multiplier, true
	}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
		multiplier, ok := models[normalized]
		return multiplier, ok
	}
	return 0, false
}

// ResolvePackagePricing picks the entitlement that funds this request and the
// multiplier its snapshot charges for the model. The entitlement snapshot wins
// over the package's current version so a later approval never re-prices quota
// the buyer already paid for.
func ResolvePackagePricing(userId, packageId int, modelName string) (*PackagePricing, error) {
	entitlement, err := model.GetServablePackageEntitlement(userId, packageId)
	if err != nil {
		if errors.Is(err, model.ErrTokenPackageEntitlementMissing) {
			return nil, ErrPackageQuotaExhausted
		}
		return nil, err
	}
	specs, err := entitlement.GetModelSpecs()
	if err != nil {
		return nil, err
	}
	snapshot := make(map[string]float64, len(specs))
	for _, spec := range specs {
		snapshot[spec.Model] = spec.Multiplier
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		return nil, err
	}
	if multiplier, ok := lookupModelMultiplier(snapshot, modelName); ok {
		return &PackagePricing{EntitlementID: entitlement.Id, Multiplier: multiplier, SellerUserID: pkg.SellerUserId}, nil
	}
	models, err := packageModelMultipliers(packageId)
	if err != nil {
		return nil, err
	}
	if multiplier, ok := lookupModelMultiplier(models, modelName); ok {
		return &PackagePricing{EntitlementID: entitlement.Id, Multiplier: multiplier, SellerUserID: pkg.SellerUserId}, nil
	}
	return nil, model.ErrTokenPackageVersionMissing
}

// PackageModelNamesForUser resolves the models a buyer may call. A sold
// entitlement keeps its own snapshot, so removing a model from a later version
// never takes it away from someone who already paid for it (INV-5).
func PackageModelNamesForUser(userId, packageId int) (map[string]struct{}, error) {
	names := make(map[string]struct{})
	if entitlement, err := model.GetServablePackageEntitlement(userId, packageId); err == nil && entitlement != nil {
		if specs, specErr := entitlement.GetModelSpecs(); specErr == nil {
			for _, spec := range specs {
				names[spec.Model] = struct{}{}
			}
			return names, nil
		}
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		return names, err
	}
	return TokenPackageModelNames(pkg)
}

// PackageAllowsModelForUser is the request-time model gate: the entitlement
// snapshot wins over the package's current version.
func PackageAllowsModelForUser(userId, packageId int, modelName string) (bool, error) {
	allowed, err := PackageModelNamesForUser(userId, packageId)
	if err != nil {
		return false, err
	}
	if _, ok := allowed[modelName]; ok {
		return true, nil
	}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
		_, ok := allowed[normalized]
		return ok, nil
	}
	return false, nil
}

// ApplyPackageRequestGate checks that a package token may call this model and
// stores the facts the request is priced with: the entitlement that pays, the
// model's multiplier and the seller. Every entry point that serves package
// requests must run it before billing; billing refuses a package request that
// arrives without them.
func ApplyPackageRequestGate(c *gin.Context, packageId int, modelName string) *types.NewAPIError {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	if modelName != "" {
		allowed, err := PackageAllowsModelForUser(userId, packageId, modelName)
		if err != nil {
			return types.NewErrorWithStatusCode(errors.New(common.TranslateMessage(c, i18n.MsgDatabaseError)), types.ErrorCodeQueryDataError, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		}
		if !allowed {
			return types.NewPackageQuotaError(errors.New(i18n.T(c, i18n.MsgPackageModelForbidden, map[string]any{"Model": modelName})), types.ErrorCodePackageModelForbidden, http.StatusForbidden)
		}
	}
	pricing, err := ResolvePackagePricing(userId, packageId, modelName)
	if err != nil {
		if errors.Is(err, ErrPackageQuotaExhausted) {
			return types.NewPackageQuotaError(errors.New(i18n.T(c, i18n.MsgPackageExpired)), types.ErrorCodePackageExpired, http.StatusForbidden)
		}
		return types.NewErrorWithStatusCode(errors.New(common.TranslateMessage(c, i18n.MsgDatabaseError)), types.ErrorCodeQueryDataError, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
	}
	common.SetContextKey(c, constant.ContextKeyPackageEntitlementId, pricing.EntitlementID)
	common.SetContextKey(c, constant.ContextKeyPackageMultiplier, pricing.Multiplier)
	common.SetContextKey(c, constant.ContextKeyPackageSellerId, pricing.SellerUserID)
	return nil
}
