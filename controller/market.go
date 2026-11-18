package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	tpkgdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// PackageBuyerUnverifiedCode marks a purchase refused because the buyer has not
// completed real-name verification (D17).
const PackageBuyerUnverifiedCode = "PACKAGE_BUYER_UNVERIFIED"

// GetMarketPackages lists packages currently on sale.
func GetMarketPackages(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	page, pageSize := pageInfo.Page, pageInfo.PageSize
	keyword := c.Query("keyword")
	modelName := c.Query("model")
	if modelName == "" {
		modelName = c.Query("model_name")
	}
	packages, total, err := model.ListMarketPackages(page, pageSize, keyword, modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sellerIDs := make([]int, 0, len(packages))
	seenSeller := make(map[int]struct{}, len(packages))
	for i := range packages {
		if _, ok := seenSeller[packages[i].SellerUserId]; ok {
			continue
		}
		seenSeller[packages[i].SellerUserId] = struct{}{}
		sellerIDs = append(sellerIDs, packages[i].SellerUserId)
	}
	sellerNames, err := model.GetUsernamesByIds(sellerIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]tpkgdto.TokenPackageResponse, 0, len(packages))
	for i := range packages {
		version, versionErr := model.GetApprovedTokenPackageVersion(&packages[i])
		if versionErr != nil {
			continue
		}
		item := buildMarketPackageResponse(&packages[i], version)
		item.SellerName = sellerNames[packages[i].SellerUserId]
		items = append(items, item)
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// GetMarketPackage returns one package's purchase detail.
func GetMarketPackage(c *gin.Context) {
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil || packageId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	if pkg.Status != constant.TokenPackageStatusListed {
		common.ApiErrorI18n(c, i18n.MsgPackageNotOnSale)
		return
	}
	version, err := model.GetApprovedTokenPackageVersion(pkg)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	response := buildMarketPackageResponse(pkg, version)
	names, err := model.GetUsernamesByIds([]int{pkg.SellerUserId})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	response.SellerName = names[pkg.SellerUserId]
	common.ApiSuccess(c, response)
}

// GetPublicMarketPackages lists packages currently on sale for anonymous
// visitors. It returns only public display fields.
func GetPublicMarketPackages(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	page, pageSize := pageInfo.Page, pageInfo.PageSize
	keyword := c.Query("keyword")
	modelName := c.Query("model")
	if modelName == "" {
		modelName = c.Query("model_name")
	}
	packages, total, err := model.ListMarketPackages(page, pageSize, keyword, modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sellerIDs := make([]int, 0, len(packages))
	seenSeller := make(map[int]struct{}, len(packages))
	for i := range packages {
		if _, ok := seenSeller[packages[i].SellerUserId]; ok {
			continue
		}
		seenSeller[packages[i].SellerUserId] = struct{}{}
		sellerIDs = append(sellerIDs, packages[i].SellerUserId)
	}
	sellerNames, err := model.GetUsernamesByIds(sellerIDs)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]tpkgdto.PublicTokenPackageResponse, 0, len(packages))
	for i := range packages {
		version, versionErr := model.GetApprovedTokenPackageVersion(&packages[i])
		if versionErr != nil {
			continue
		}
		item := buildPublicMarketPackageResponse(&packages[i], version)
		item.SellerName = sellerNames[packages[i].SellerUserId]
		items = append(items, item)
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

// GetPublicMarketPackage returns one package's public purchase detail.
func GetPublicMarketPackage(c *gin.Context) {
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil || packageId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	if pkg.Status != constant.TokenPackageStatusListed {
		common.ApiErrorI18n(c, i18n.MsgPackageNotOnSale)
		return
	}
	version, err := model.GetApprovedTokenPackageVersion(pkg)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	response := buildPublicMarketPackageResponse(pkg, version)
	names, err := model.GetUsernamesByIds([]int{pkg.SellerUserId})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	response.SellerName = names[pkg.SellerUserId]
	common.ApiSuccess(c, response)
}

func buildMarketPackageResponse(pkg *model.TokenPackage, version *model.TokenPackageVersion) tpkgdto.TokenPackageResponse {
	response := tpkgdto.TokenPackageResponse{
		ID:              pkg.Id,
		SellerUserID:    pkg.SellerUserId,
		BillingMode:     pkg.BillingMode,
		Title:           pkg.Title,
		Subtitle:        pkg.Subtitle,
		Description:     pkg.Description,
		Status:          pkg.Status,
		ActiveVersionID: pkg.ActiveVersionId,
		Degraded:        pkg.Degraded,
		CreatedAt:       pkg.CreatedAt,
		UpdatedAt:       pkg.UpdatedAt,
	}
	if version != nil {
		// Marketplace responses never expose bound channel ids or keys.
		response.ActiveVersion = buildTokenPackageVersionResponse(version, nil)
	}
	return response
}

func buildPublicMarketPackageResponse(pkg *model.TokenPackage, version *model.TokenPackageVersion) tpkgdto.PublicTokenPackageResponse {
	response := tpkgdto.PublicTokenPackageResponse{
		ID:          pkg.Id,
		Title:       pkg.Title,
		Subtitle:    pkg.Subtitle,
		Description: pkg.Description,
		Degraded:    pkg.Degraded,
	}
	if version != nil {
		response.ActiveVersion = &tpkgdto.PublicTokenPackageVersionResponse{
			Models: version.GetModelSpecs(),
			SKUs:   version.GetSKUList(),
		}
	}
	return response
}

// PurchaseMarketPackage buys one SKU with wallet balance.
func PurchaseMarketPackage(c *gin.Context) {
	userId := c.GetInt("id")
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil || packageId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	var req tpkgdto.PurchaseTokenPackageRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SKUKey == "" {
		common.ApiErrorI18n(c, i18n.MsgPackageSKUNotFound)
		return
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	eligibility, err := service.EvaluateSellerEligibility(pkg.SellerUserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !eligibility.Eligible {
		common.ApiErrorI18n(c, i18n.MsgPackageNotOnSale)
		return
	}
	result, err := model.PurchaseTokenPackage(userId, packageId, req.SKUKey, eligibility.EffectiveCommissionBps,
		func(_ *gorm.DB, sellerUserId int) error {
			seller, evalErr := service.EvaluateSellerEligibility(sellerUserId)
			if evalErr != nil {
				return evalErr
			}
			if !seller.Eligible {
				return model.ErrPackageNotOnSale
			}
			return nil
		})
	if err != nil {
		writePackagePurchaseError(c, err)
		return
	}
	service.InvalidatePackageEntitlementCache(userId, packageId)
	common.ApiSuccess(c, gin.H{
		"order":       buildTokenPackageOrderResponse(result.Order),
		"entitlement": buildTokenPackageEntitlementResponse(result.Entitlement, pkg),
	})
}

func writePackagePurchaseError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrPackageInsufficientFunds):
		common.ApiErrorI18n(c, i18n.MsgPackagePurchaseInsufficient)
	case errors.Is(err, model.ErrPackageSelfPurchase):
		common.ApiErrorI18n(c, i18n.MsgPackageSelfPurchase)
	case errors.Is(err, model.ErrPackageSameRealnameDeal):
		common.ApiErrorI18n(c, i18n.MsgPackageSameRealnameDeal)
	case errors.Is(err, model.ErrPackageBuyerUnverified):
		// The code lets the console open the verification guide instead of
		// only showing the message.
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": common.TranslateMessage(c, i18n.MsgPackageBuyerUnverified),
			"code":    PackageBuyerUnverifiedCode,
		})
	case errors.Is(err, model.ErrPackageNotOnSale):
		common.ApiErrorI18n(c, i18n.MsgPackageNotOnSale)
	case errors.Is(err, model.ErrPackageSKUNotFound):
		common.ApiErrorI18n(c, i18n.MsgPackageSKUNotFound)
	default:
		common.ApiError(c, err)
	}
}

func buildTokenPackageOrderResponse(order *model.TokenPackageOrder) tpkgdto.TokenPackageOrderResponse {
	response := tpkgdto.TokenPackageOrderResponse{
		ID:              order.Id,
		TradeNo:         order.TradeNo,
		BuyerUserID:     order.BuyerUserId,
		PackageID:       order.PackageId,
		VersionID:       order.VersionId,
		PriceQuota:      order.PriceQuota,
		CommissionBps:   order.CommissionBps,
		CommissionQuota: order.CommissionQuota,
		SellerQuota:     order.SellerQuota,
		Status:          order.Status,
		RefundedQuota:   order.RefundedQuota,
		CreatedAt:       order.CreatedAt,
	}
	if sku, err := order.GetSKUSnapshot(); err == nil {
		response.SKUSnapshot = sku
	}
	return response
}

func buildTokenPackageEntitlementResponse(entitlement *model.TokenPackageEntitlement, pkg *model.TokenPackage) tpkgdto.TokenPackageEntitlementResponse {
	response := tpkgdto.TokenPackageEntitlementResponse{
		ID:              entitlement.Id,
		UserID:          entitlement.UserId,
		PackageID:       entitlement.PackageId,
		VersionID:       entitlement.VersionId,
		OrderID:         entitlement.OrderId,
		BillingMode:     entitlement.BillingMode,
		AmountTotal:     entitlement.AmountTotal,
		AmountUsed:      entitlement.AmountUsed,
		AmountRemaining: entitlement.AmountRemaining(),
		PaidQuota:       entitlement.PaidQuota,
		StartTime:       entitlement.StartTime,
		EndTime:         entitlement.EndTime,
		ExtendedSeconds: entitlement.ExtendedSeconds,
		Status:          entitlement.Status,
		RefundedQuota:   entitlement.RefundedQuota,
		CreatedAt:       entitlement.CreatedAt,
	}
	if pkg != nil {
		response.PackageTitle = pkg.Title
		response.PackageStatus = pkg.Status
	}
	if specs, err := entitlement.GetModelSpecs(); err == nil {
		response.ModelsSnapshot = specs
	}
	return response
}

// GetUserPackageEntitlements lists the buyer's purchased packages.
func GetUserPackageEntitlements(c *gin.Context) {
	userId := c.GetInt("id")
	entitlements, err := model.ListTokenPackageEntitlementsByUser(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	titles := make(map[int]*model.TokenPackage, len(entitlements))
	items := make([]tpkgdto.TokenPackageEntitlementResponse, 0, len(entitlements))
	for i := range entitlements {
		pkg, ok := titles[entitlements[i].PackageId]
		if !ok {
			pkg, _ = model.GetTokenPackageById(entitlements[i].PackageId)
			titles[entitlements[i].PackageId] = pkg
		}
		items = append(items, buildTokenPackageEntitlementResponse(entitlements[i], pkg))
	}
	common.ApiSuccess(c, items)
}
