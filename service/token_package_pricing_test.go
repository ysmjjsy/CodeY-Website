package service

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	tpkgdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPackagePricingTest(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&model.Channel{},
		&model.Ability{},
		&model.TokenPackage{},
		&model.TokenPackageVersion{},
		&model.TokenPackageChannel{},
		&model.TokenPackageEntitlement{},
		&model.TokenPackagePreconsumeRecord{},
	))
	model.DB = db
	t.Cleanup(func() {
		model.DB = originalDB
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func createPricingPackage(t *testing.T, versionMultiplier float64) *model.TokenPackage {
	t.Helper()
	pkg := &model.TokenPackage{
		SellerUserId: 2,
		BillingMode:  constant.TokenPackageBillingModeQuota,
		Title:        "Pricing package",
		Status:       constant.TokenPackageStatusListed,
	}
	require.NoError(t, model.DB.Create(pkg).Error)
	version := &model.TokenPackageVersion{
		PackageId: pkg.Id,
		VersionNo: 1,
		Status:    constant.TokenPackageVersionStatusApproved,
	}
	version.SetModelSpecs([]tpkgdto.TokenPackageModelSpec{{Model: "gpt-test", Multiplier: versionMultiplier}})
	require.NoError(t, model.DB.Create(version).Error)
	pkg.ActiveVersionId = version.Id
	require.NoError(t, model.DB.Model(pkg).Update("active_version_id", version.Id).Error)
	return pkg
}

func createPricingEntitlement(t *testing.T, userId, packageId, versionId int, multiplier float64, amountTotal int64) *model.TokenPackageEntitlement {
	t.Helper()
	entitlement := &model.TokenPackageEntitlement{
		UserId:      userId,
		PackageId:   packageId,
		VersionId:   versionId,
		OrderId:     1,
		BillingMode: constant.TokenPackageBillingModeQuota,
		AmountTotal: amountTotal,
		EndTime:     common.GetTimestamp() + 86400,
		Status:      constant.TokenPackageEntitlementStatusActive,
	}
	require.NoError(t, entitlement.SetModelSpecs([]tpkgdto.TokenPackageModelSpec{{Model: "gpt-test", Multiplier: multiplier}}))
	require.NoError(t, model.DB.Create(entitlement).Error)
	return entitlement
}

func TestResolvePackagePricingUsesEntitlementSnapshot(t *testing.T) {
	setupPackagePricingTest(t)
	pkg := createPricingPackage(t, 5)
	versionId := pkg.ActiveVersionId
	entitlement := createPricingEntitlement(t, 7, pkg.Id, versionId, 2, 1000)

	pricing, err := ResolvePackagePricing(7, pkg.Id, "gpt-test")
	require.NoError(t, err)
	assert.Equal(t, entitlement.Id, pricing.EntitlementID)
	assert.Equal(t, 2.0, pricing.Multiplier, "sold snapshot must win over the current version")
	assert.Equal(t, 2, pricing.SellerUserID)

	_, err = ResolvePackagePricing(7, pkg.Id, "unknown-model")
	assert.Error(t, err)

	require.NoError(t, model.DB.Model(&model.TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).
		Update("end_time", common.GetTimestamp()-1).Error)
	_, err = ResolvePackagePricing(7, pkg.Id, "gpt-test")
	assert.ErrorIs(t, err, ErrPackageQuotaExhausted)
}

func TestPackageFundingPreconsumeSettleAndRefund(t *testing.T) {
	setupPackagePricingTest(t)
	pkg := createPricingPackage(t, 1)
	entitlement := createPricingEntitlement(t, 7, pkg.Id, pkg.ActiveVersionId, 1, 1000)

	funding := &PackageFunding{userId: 7, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-1"}
	require.NoError(t, funding.PreConsume(100))
	require.NoError(t, funding.Settle(20))

	stored, err := model.GetTokenPackageEntitlement(entitlement.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(120), stored.AmountUsed)

	// Settling the same request twice must not move quota again.
	require.NoError(t, funding.Settle(20))
	stored, err = model.GetTokenPackageEntitlement(entitlement.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(120), stored.AmountUsed)

	failed := &PackageFunding{userId: 7, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-2"}
	require.NoError(t, failed.PreConsume(50))
	require.NoError(t, failed.Refund())
	stored, err = model.GetTokenPackageEntitlement(entitlement.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(120), stored.AmountUsed, "refund returns exactly the reserved amount")

	// Exhausting the entitlement rejects the next request instead of falling
	// back to wallet billing.
	spend := &PackageFunding{userId: 7, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-3"}
	require.NoError(t, spend.PreConsume(880))
	require.NoError(t, spend.Settle(0))
	exhausted := &PackageFunding{userId: 7, packageId: pkg.Id, entitlementId: entitlement.Id, requestId: "req-4"}
	assert.ErrorIs(t, exhausted.PreConsume(1), ErrPackageQuotaExhausted)
}
