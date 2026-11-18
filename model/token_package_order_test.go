package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTokenPackageOrderTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&User{}, &Channel{}, &TokenPackage{}, &TokenPackageVersion{}, &TokenPackageChannel{},
		&TokenPackageEntitlement{}, &TokenPackageOrder{}, &SellerLedgerEntry{}, &SellerProfile{}, &UserVerification{},
		&TokenPackagePreconsumeRecord{}))
	for _, table := range []string{"users", "token_packages", "token_package_versions", "token_package_channels",
		"token_package_entitlements", "token_package_orders", "seller_ledger_entries", "seller_profiles",
		"user_verifications", "token_package_preconsume_records"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
	previousMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = previousMemoryCache
	})
}

func seedTokenPackageForSale(t *testing.T, sellerId int, priceQuota, creditQuota int64) *TokenPackage {
	t.Helper()
	pkg := &TokenPackage{
		SellerUserId: sellerId,
		BillingMode:  constant.TokenPackageBillingModeQuota,
		Title:        "Test package",
		Status:       constant.TokenPackageStatusListed,
	}
	require.NoError(t, DB.Create(pkg).Error)

	version := &TokenPackageVersion{
		PackageId: pkg.Id,
		VersionNo: 1,
		Status:    constant.TokenPackageVersionStatusApproved,
	}
	require.NoError(t, version.SetModelSpecs([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 1.5}}))
	require.NoError(t, version.SetSKUList([]dto.TokenPackageSKU{{
		SKUKey:      "starter",
		Title:       "Starter",
		PriceQuota:  priceQuota,
		CreditQuota: creditQuota,
		ValidDays:   30,
	}}))
	require.NoError(t, DB.Create(version).Error)
	require.NoError(t, DB.Model(&TokenPackage{}).Where("id = ?", pkg.Id).
		Update("active_version_id", version.Id).Error)
	pkg.ActiveVersionId = version.Id
	return pkg
}

func seedVerified(t *testing.T, userId int) {
	t.Helper()
	require.NoError(t, DB.Create(&UserVerification{
		UserId:       userId,
		Status:       constant.UserVerificationStatusVerified,
		IdNumberHash: "verified-" + common.GetRandomString(8),
	}).Error)
}

func seedBuyer(t *testing.T, quota int) *User {
	t.Helper()
	user := &User{
		Username: common.GetRandomString(8),
		AffCode:  common.GetRandomString(8),
		Quota:    quota,
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func TestPurchaseTokenPackageDebitsBuyerAndFreezesSellerShare(t *testing.T) {
	setupTokenPackageOrderTest(t)

	seller := seedBuyer(t, 0)
	buyer := seedBuyer(t, 100000)
	seedVerified(t, buyer.Id)
	pkg := seedTokenPackageForSale(t, seller.Id, 10000, 200000)

	result, err := PurchaseTokenPackage(buyer.Id, pkg.Id, "starter", 1000, nil)
	require.NoError(t, err)

	var storedBuyer User
	require.NoError(t, DB.First(&storedBuyer, buyer.Id).Error)
	assert.Equal(t, 90000, storedBuyer.Quota, "the buyer wallet is charged exactly the SKU price")

	assert.Equal(t, int64(10000), result.Order.PriceQuota)
	assert.Equal(t, int64(1000), result.Order.CommissionQuota)
	assert.Equal(t, int64(9000), result.Order.SellerQuota)
	assert.Equal(t, constant.TokenPackageOrderStatusPaid, result.Order.Status)

	assert.Equal(t, buyer.Id, result.Entitlement.UserId)
	assert.Equal(t, int64(200000), result.Entitlement.AmountTotal)
	assert.Equal(t, int64(200000), result.Entitlement.AmountRemaining())
	assert.Equal(t, int64(9000), result.Entitlement.SellerQuotaTotal)
	assert.Equal(t, constant.TokenPackageEntitlementStatusActive, result.Entitlement.Status)
	specs, err := result.Entitlement.GetModelSpecs()
	require.NoError(t, err)
	require.Len(t, specs, 1)
	assert.Equal(t, "gpt-4o", specs[0].Model)
	assert.InDelta(t, 1.5, specs[0].Multiplier, 0.0001)

	var profile SellerProfile
	require.NoError(t, DB.Where("user_id = ?", seller.Id).First(&profile).Error)
	assert.Equal(t, int64(9000), profile.PendingQuota)

	var entry SellerLedgerEntry
	require.NoError(t, DB.Where("order_id = ?", result.Order.Id).First(&entry).Error)
	assert.Equal(t, constant.SellerLedgerTypeSalePending, entry.Type)
	assert.Equal(t, constant.SellerLedgerStatusPending, entry.Status)
	assert.Equal(t, int64(9000), entry.Amount)
}

func TestPurchaseTokenPackageRejectsInvalidDeals(t *testing.T) {
	setupTokenPackageOrderTest(t)

	seller := seedBuyer(t, 0)
	buyer := seedBuyer(t, 5000)
	pkg := seedTokenPackageForSale(t, seller.Id, 10000, 100000)

	_, err := PurchaseTokenPackage(buyer.Id, pkg.Id, "starter", 1000, nil)
	assert.ErrorIs(t, err, ErrPackageInsufficientFunds)

	richBuyer := seedBuyer(t, 100000)
	seedVerified(t, richBuyer.Id)
	_, err = PurchaseTokenPackage(seller.Id, pkg.Id, "starter", 1000, nil)
	assert.ErrorIs(t, err, ErrPackageSelfPurchase)

	_, err = PurchaseTokenPackage(richBuyer.Id, pkg.Id, "missing", 1000, nil)
	assert.ErrorIs(t, err, ErrPackageSKUNotFound)

	_, err = PurchaseTokenPackage(richBuyer.Id, pkg.Id, "starter", 1000, func(_ *gorm.DB, _ int) error {
		return ErrPackageNotOnSale
	})
	assert.ErrorIs(t, err, ErrPackageNotOnSale)

	var count int64
	require.NoError(t, DB.Model(&TokenPackageOrder{}).Count(&count).Error)
	assert.Zero(t, count, "a rejected purchase writes no order")
	var storedBuyer User
	require.NoError(t, DB.First(&storedBuyer, richBuyer.Id).Error)
	assert.Equal(t, 100000, storedBuyer.Quota, "a rejected purchase leaves the wallet untouched")
}

func TestPurchaseTokenPackageRejectsSameRealnameSubject(t *testing.T) {
	setupTokenPackageOrderTest(t)

	seller := seedBuyer(t, 0)
	buyer := seedBuyer(t, 100000)
	pkg := seedTokenPackageForSale(t, seller.Id, 10000, 100000)

	hash := "hmac-of-id-number"
	require.NoError(t, DB.Create(&UserVerification{UserId: seller.Id, Status: constant.UserVerificationStatusVerified, IdNumberHash: hash}).Error)
	require.NoError(t, DB.Create(&UserVerification{UserId: buyer.Id, Status: constant.UserVerificationStatusVerified, IdNumberHash: hash}).Error)

	_, err := PurchaseTokenPackage(buyer.Id, pkg.Id, "starter", 1000, nil)
	assert.ErrorIs(t, err, ErrPackageSameRealnameDeal)
}

func TestPurchaseTokenPackageRejectsUnverifiedBuyer(t *testing.T) {
	setupTokenPackageOrderTest(t)

	seller := seedBuyer(t, 0)
	buyer := seedBuyer(t, 100000)
	pkg := seedTokenPackageForSale(t, seller.Id, 10000, 100000)

	_, err := PurchaseTokenPackage(buyer.Id, pkg.Id, "starter", 1000, nil)
	assert.ErrorIs(t, err, ErrPackageBuyerUnverified)

	var count int64
	require.NoError(t, DB.Model(&TokenPackageOrder{}).Count(&count).Error)
	assert.Zero(t, count, "an unverified buyer gets no order")
}
