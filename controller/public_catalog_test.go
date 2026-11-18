package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	tpkgdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPublicCatalogTest(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := model.DB
	dsn := fmt.Sprintf(
		"file:%s-%s?mode=memory&cache=shared",
		strings.ReplaceAll(t.Name(), "/", "_"),
		common.GetRandomString(8),
	)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.TokenPackage{},
		&model.TokenPackageVersion{},
		&model.SubscriptionPlan{},
	))
	model.DB = db
	t.Cleanup(func() {
		model.DB = originalDB
		sqlDB, closeErr := db.DB()
		if closeErr == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func callPublicCatalogHandler(
	t *testing.T,
	handler gin.HandlerFunc,
	target string,
	params ...gin.Param,
) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, target, nil)
	context.Params = params
	handler(context)

	var payload map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	return payload
}

func createPublicCatalogPackage(
	t *testing.T,
	db *gorm.DB,
	sellerID int,
	title string,
	status string,
) *model.TokenPackage {
	t.Helper()
	pkg := &model.TokenPackage{
		SellerUserId: sellerID,
		BillingMode:  constant.TokenPackageBillingModeQuota,
		Title:        title,
		Subtitle:     "public subtitle",
		Description:  "public description",
		Status:       status,
	}
	require.NoError(t, db.Create(pkg).Error)

	version := &model.TokenPackageVersion{
		PackageId:  pkg.Id,
		VersionNo:  1,
		Status:     constant.TokenPackageVersionStatusApproved,
		ReviewedBy: 99,
		ReviewNote: "internal review note",
		TestReport: `{"checked_at":1,"passed":true,"results":[]}`,
	}
	require.NoError(t, version.SetModelSpecs([]tpkgdto.TokenPackageModelSpec{{
		Model:      "gpt-public",
		Multiplier: 1.25,
	}}))
	require.NoError(t, version.SetSKUList([]tpkgdto.TokenPackageSKU{{
		SKUKey:      "starter",
		Title:       "Starter",
		PriceQuota:  100,
		CreditQuota: 200,
		ValidDays:   30,
	}}))
	require.NoError(t, db.Create(version).Error)
	require.NoError(t, db.Model(&model.TokenPackage{}).
		Where("id = ?", pkg.Id).
		Update("active_version_id", version.Id).Error)
	pkg.ActiveVersionId = version.Id
	return pkg
}

func TestPublicMarketCatalogReturnsOnlyListedPackagesAndPublicFields(t *testing.T) {
	db := setupPublicCatalogTest(t)
	require.NoError(t, db.Create(&model.User{
		Username: "seller-name",
		AffCode:  "aff-" + common.GetRandomString(8),
		Status:   common.UserStatusEnabled,
	}).Error)

	listed := createPublicCatalogPackage(t, db, 1, "Listed package", constant.TokenPackageStatusListed)
	_ = createPublicCatalogPackage(t, db, 1, "Draft package", constant.TokenPackageStatusDraft)
	_ = createPublicCatalogPackage(t, db, 1, "Stopped package", constant.TokenPackageStatusStopped)

	listPayload := callPublicCatalogHandler(t, GetPublicMarketPackages, "/api/market/public/packages?p=1&page_size=20")
	require.Equal(t, true, listPayload["success"], listPayload["message"])
	listData := listPayload["data"].(map[string]any)
	assert.Equal(t, float64(1), listData["total"])
	items := listData["items"].([]any)
	require.Len(t, items, 1)

	item := items[0].(map[string]any)
	assert.Equal(t, float64(listed.Id), item["id"])
	assert.Equal(t, "seller-name", item["seller_name"])
	for _, field := range []string{
		"seller_user_id",
		"billing_mode",
		"status",
		"active_version_id",
		"created_at",
		"updated_at",
	} {
		assert.NotContains(t, item, field)
	}

	activeVersion := item["active_version"].(map[string]any)
	for _, field := range []string{
		"id",
		"package_id",
		"version_no",
		"status",
		"channels",
		"test_report",
		"submitted_at",
		"reviewed_by",
		"reviewed_at",
		"review_note",
		"created_at",
	} {
		assert.NotContains(t, activeVersion, field)
	}
	models := activeVersion["models"].([]any)
	require.Len(t, models, 1)
	assert.Equal(t, "gpt-public", models[0].(map[string]any)["model"])
	assert.Equal(t, 1.25, models[0].(map[string]any)["multiplier"])

	detailPayload := callPublicCatalogHandler(
		t,
		GetPublicMarketPackage,
		"/api/market/public/packages/1",
		gin.Param{Key: "id", Value: "1"},
	)
	require.Equal(t, true, detailPayload["success"], detailPayload["message"])
	detail := detailPayload["data"].(map[string]any)
	assert.Equal(t, "Listed package", detail["title"])
	assert.NotContains(t, detail, "seller_user_id")
	assert.NotContains(t, detail["active_version"].(map[string]any), "test_report")

	stoppedPayload := callPublicCatalogHandler(
		t,
		GetPublicMarketPackage,
		"/api/market/public/packages/3",
		gin.Param{Key: "id", Value: "3"},
	)
	assert.Equal(t, false, stoppedPayload["success"])
}

func TestPublicSubscriptionCatalogHidesInternalFieldsAndHonorsCompliance(t *testing.T) {
	db := setupPublicCatalogTest(t)
	plan := &model.SubscriptionPlan{
		Title:                 "Starter",
		Subtitle:              "For individuals",
		PriceAmount:           10,
		Currency:              "USD",
		DurationUnit:          "month",
		DurationValue:         1,
		Enabled:               true,
		SortOrder:             7,
		TotalAmount:           500000,
		QuotaResetPeriod:      "monthly",
		MaxPurchasePerUser:    2,
		StripePriceId:         "price_secret",
		CreemProductId:        "creem_secret",
		WaffoPancakeProductId: "waffo_secret",
		UpgradeGroup:          "vip",
	}
	require.NoError(t, db.Create(plan).Error)
	disabledPlan := &model.SubscriptionPlan{
		Title:   "Disabled",
		Enabled: false,
	}
	require.NoError(t, db.Create(disabledPlan).Error)
	require.NoError(t, db.Model(&model.SubscriptionPlan{}).
		Where("id = ?", disabledPlan.Id).
		Update("enabled", false).Error)

	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})

	paymentSetting.ComplianceConfirmed = false
	blockedPayload := callPublicCatalogHandler(t, GetPublicSubscriptionPlans, "/api/subscription/public/plans")
	require.Equal(t, true, blockedPayload["success"], blockedPayload["message"])
	assert.Empty(t, blockedPayload["data"].([]any))

	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	payload := callPublicCatalogHandler(t, GetPublicSubscriptionPlans, "/api/subscription/public/plans")
	require.Equal(t, true, payload["success"], payload["message"])
	items := payload["data"].([]any)
	require.Len(t, items, 1)

	item := items[0].(map[string]any)
	assert.Equal(t, float64(plan.Id), item["id"])
	assert.Equal(t, "Starter", item["title"])
	assert.Equal(t, 10.0, item["price_amount"])
	assert.Equal(t, float64(500000), item["total_amount"])
	for _, field := range []string{
		"enabled",
		"sort_order",
		"stripe_price_id",
		"creem_product_id",
		"waffo_pancake_product_id",
		"upgrade_group",
		"downgrade_group",
		"allow_balance_pay",
		"allow_wallet_overflow",
		"created_at",
		"updated_at",
	} {
		assert.NotContains(t, item, field)
	}
}
