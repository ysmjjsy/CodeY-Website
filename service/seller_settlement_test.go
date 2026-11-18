package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupSellerSettlementTest(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Channel{}, &model.TokenPackage{}, &model.TokenPackageVersion{},
		&model.TokenPackageChannel{}, &model.TokenPackageEntitlement{}, &model.TokenPackageOrder{}, &model.SellerLedgerEntry{},
		&model.SellerProfile{}, &model.UserVerification{}, &model.TokenPackagePreconsumeRecord{}))
	for _, table := range []string{"users", "token_packages", "token_package_versions", "token_package_channels",
		"token_package_entitlements", "token_package_orders", "seller_ledger_entries", "seller_profiles",
		"user_verifications", "token_package_preconsume_records"} {
		require.NoError(t, model.DB.Exec("DELETE FROM "+table).Error)
	}
	previousMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = previousMemoryCache })
}

func newSettlementUser(t *testing.T, quota int) *model.User {
	t.Helper()
	user := &model.User{
		Username: common.GetRandomString(8),
		AffCode:  common.GetRandomString(8),
		Quota:    quota,
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, model.DB.Create(user).Error)
	if quota > 0 {
		require.NoError(t, model.DB.Create(&model.UserVerification{
			UserId:       user.Id,
			Status:       constant.UserVerificationStatusVerified,
			IdNumberHash: "verified-" + common.GetRandomString(8),
		}).Error)
	}
	return user
}

func newSettlementPackage(t *testing.T, sellerId int, priceQuota, creditQuota int64) *model.TokenPackage {
	t.Helper()
	pkg := &model.TokenPackage{
		SellerUserId: sellerId,
		BillingMode:  constant.TokenPackageBillingModeQuota,
		Title:        "Settlement package",
		Status:       constant.TokenPackageStatusListed,
	}
	require.NoError(t, model.DB.Create(pkg).Error)
	version := &model.TokenPackageVersion{
		PackageId: pkg.Id,
		VersionNo: 1,
		Status:    constant.TokenPackageVersionStatusApproved,
	}
	require.NoError(t, version.SetModelSpecs([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 1}}))
	require.NoError(t, version.SetSKUList([]dto.TokenPackageSKU{{
		SKUKey:      "quota",
		Title:       "Quota",
		PriceQuota:  priceQuota,
		CreditQuota: creditQuota,
		ValidDays:   30,
	}}))
	require.NoError(t, model.DB.Create(version).Error)
	require.NoError(t, model.DB.Model(&model.TokenPackage{}).Where("id = ?", pkg.Id).
		Update("active_version_id", version.Id).Error)
	pkg.ActiveVersionId = version.Id
	return pkg
}

// TestSellerSettlementMoneyConservation checks that buyer refund + seller
// revenue + platform commission always add up to the price paid, including
// fractions that do not divide evenly.
func TestSellerSettlementMoneyConservation(t *testing.T) {
	cases := []struct {
		name        string
		price       int64
		credit      int64
		usedPercent int64
		commission  int
	}{
		{name: "unused", price: 10000, credit: 100000, usedPercent: 0, commission: 1000},
		{name: "third-used", price: 9999, credit: 100000, usedPercent: 33, commission: 1300},
		{name: "half-used", price: 12345, credit: 77777, usedPercent: 50, commission: 1000},
		{name: "almost-exhausted", price: 50000, credit: 100000, usedPercent: 99, commission: 2500},
		{name: "exhausted", price: 10000, credit: 100000, usedPercent: 100, commission: 1000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setupSellerSettlementTest(t)
			seller := newSettlementUser(t, 0)
			buyer := newSettlementUser(t, 1000000)
			pkg := newSettlementPackage(t, seller.Id, tc.price, tc.credit)

			result, err := model.PurchaseTokenPackage(buyer.Id, pkg.Id, "quota", tc.commission, nil)
			require.NoError(t, err)
			entitlement := result.Entitlement
			order := result.Order

			used := tc.credit * tc.usedPercent / 100
			require.NoError(t, model.PreConsumePackageEntitlement(entitlement.Id, "req-"+tc.name, used))
			require.NoError(t, model.SettlePackagePreconsume("req-"+tc.name, 0))

			now := common.GetTimestamp()
			_, err = RunSellerSettlement(now)
			require.NoError(t, err)

			// Pretend the freeze window passed and pay the seller.
			_, settledQuota, err := model.SettleFrozenSellerEntries(now + 1000*86400)
			require.NoError(t, err)
			_, err = TerminateTokenPackage(context.Background(), pkg.Id)
			require.NoError(t, err)

			var storedBuyer, storedSeller model.User
			require.NoError(t, model.DB.First(&storedBuyer, buyer.Id).Error)
			require.NoError(t, model.DB.First(&storedSeller, seller.Id).Error)
			var storedOrder model.TokenPackageOrder
			require.NoError(t, model.DB.First(&storedOrder, order.Id).Error)
			var profile model.SellerProfile
			require.NoError(t, model.DB.Where("user_id = ?", seller.Id).First(&profile).Error)

			refund := storedOrder.RefundedQuota
			assert.Equal(t, refund, int64(storedBuyer.Quota-(1000000-int(tc.price))), "buyer gets exactly the refund recorded on the order")
			assert.Equal(t, settledQuota, int64(storedSeller.Quota), "seller gets exactly the released share")
			assert.Zero(t, profile.PendingQuota, "no seller share stays pending after termination")
			assert.Zero(t, profile.FrozenQuota, "no seller share stays frozen after termination")

			platformKept := tc.price - refund - settledQuota
			assert.GreaterOrEqual(t, platformKept, int64(0), "platform share never goes negative")
			assert.Equal(t, tc.price, refund+settledQuota+platformKept, "money is conserved")

			commissionQuota := tc.price * int64(tc.commission) / 10000
			maxPlatform := commissionQuota
			assert.LessOrEqual(t, platformKept, maxPlatform, "platform never keeps more than its commission")
		})
	}
}

func TestSellerSettlementIsIdempotent(t *testing.T) {
	setupSellerSettlementTest(t)
	seller := newSettlementUser(t, 0)
	buyer := newSettlementUser(t, 100000)
	pkg := newSettlementPackage(t, seller.Id, 10000, 100000)

	result, err := model.PurchaseTokenPackage(buyer.Id, pkg.Id, "quota", 1000, nil)
	require.NoError(t, err)
	require.NoError(t, model.PreConsumePackageEntitlement(result.Entitlement.Id, "req-idem", 50000))
	require.NoError(t, model.SettlePackagePreconsume("req-idem", 0))

	now := common.GetTimestamp()
	first, err := RunSellerSettlement(now)
	require.NoError(t, err)
	second, err := RunSellerSettlement(now)
	require.NoError(t, err)
	assert.Equal(t, int64(4500), first.ReleasedQuota)
	assert.Zero(t, second.ReleasedQuota, "a second run releases nothing new")

	_, settled, err := model.SettleFrozenSellerEntries(now + 1000*86400)
	require.NoError(t, err)
	assert.Equal(t, int64(4500), settled)

	_, settledAgain, err := model.SettleFrozenSellerEntries(now + 1000*86400)
	require.NoError(t, err)
	assert.Zero(t, settledAgain, "frozen entries pay once")
}

func TestSellerSettlementExpiresEndedEntitlementWithoutRefund(t *testing.T) {
	setupSellerSettlementTest(t)
	seller := newSettlementUser(t, 0)
	buyer := newSettlementUser(t, 100000)
	pkg := newSettlementPackage(t, seller.Id, 10000, 100000)

	result, err := model.PurchaseTokenPackage(buyer.Id, pkg.Id, "quota", 1000, nil)
	require.NoError(t, err)
	require.NoError(t, model.PreConsumePackageEntitlement(result.Entitlement.Id, "req-exp", 10000))
	require.NoError(t, model.SettlePackagePreconsume("req-exp", 0))

	future := result.Entitlement.EndTime + 1
	summary, err := RunSellerSettlement(future)
	require.NoError(t, err)
	assert.Equal(t, 1, summary.ExpiredCount)

	var entitlement model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&entitlement, result.Entitlement.Id).Error)
	assert.Equal(t, constant.TokenPackageEntitlementStatusExpired, entitlement.Status)

	var storedBuyer model.User
	require.NoError(t, model.DB.First(&storedBuyer, buyer.Id).Error)
	assert.Equal(t, 90000, storedBuyer.Quota, "expiry never refunds the buyer (D15)")

	_, settled, err := model.SettleFrozenSellerEntries(entitlement.EndTime + 1000*86400)
	require.NoError(t, err)
	assert.Equal(t, int64(9000), settled, "the seller receives the full remaining share after expiry")
}

func TestTerminationSettlesInFlightRequestBeforeRefund(t *testing.T) {
	setupSellerSettlementTest(t)
	seller := newSettlementUser(t, 0)
	buyer := newSettlementUser(t, 100000)
	pkg := newSettlementPackage(t, seller.Id, 10000, 100000)

	result, err := model.PurchaseTokenPackage(buyer.Id, pkg.Id, "quota", 1000, nil)
	require.NoError(t, err)
	require.NoError(t, model.PreConsumePackageEntitlement(result.Entitlement.Id, "req-inflight", 40000))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = TerminateTokenPackage(ctx, pkg.Id)
	require.NoError(t, err)

	var record model.TokenPackagePreconsumeRecord
	require.NoError(t, model.DB.Where("request_id = ?", "req-inflight").First(&record).Error)
	assert.Equal(t, constant.TokenPackagePreConsumeSettled, record.Status, "in-flight request is closed at its reserved amount")

	var storedOrder model.TokenPackageOrder
	require.NoError(t, model.DB.First(&storedOrder, result.Order.Id).Error)
	assert.Equal(t, int64(6000), storedOrder.RefundedQuota, "refund covers the unused 60 percent")
	assert.Equal(t, constant.TokenPackageOrderStatusRefunded, storedOrder.Status)

	var entitlement model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&entitlement, result.Entitlement.Id).Error)
	assert.Equal(t, constant.TokenPackageEntitlementStatusTerminated, entitlement.Status)
	assert.Equal(t, int64(40000), entitlement.AmountUsed, "the in-flight reserve still counts as used")
}

func TestTerminationRefundsSurviveSettlementAndCoverEveryPackage(t *testing.T) {
	setupSellerSettlementTest(t)
	seller := newSettlementUser(t, 0)
	buyer := newSettlementUser(t, 100000)
	first := newSettlementPackage(t, seller.Id, 10000, 100000)
	second := newSettlementPackage(t, seller.Id, 20000, 100000)
	firstPurchase, err := model.PurchaseTokenPackage(buyer.Id, first.Id, "quota", 1000, nil)
	require.NoError(t, err)
	_, err = model.PurchaseTokenPackage(buyer.Id, second.Id, "quota", 1000, nil)
	require.NoError(t, err)

	// Both packages are terminated, then the refund stalls long enough for the
	// first entitlement to pass its end time.
	_, err = MarkTokenPackageTerminated(first.Id)
	require.NoError(t, err)
	_, err = MarkTokenPackageTerminated(second.Id)
	require.NoError(t, err)
	now := common.GetTimestamp()
	require.NoError(t, model.DB.Model(&model.TokenPackageEntitlement{}).Where("id = ?", firstPurchase.Entitlement.Id).
		Update("end_time", now-10).Error)

	_, err = RunSellerSettlement(now)
	require.NoError(t, err)
	var stalled model.TokenPackageEntitlement
	require.NoError(t, model.DB.First(&stalled, firstPurchase.Entitlement.Id).Error)
	assert.Equal(t, constant.TokenPackageEntitlementStatusActive, stalled.Status, "settlement leaves a terminated package to its refund")
	assert.Zero(t, stalled.SellerQuotaReleased, "the buyer's unused share is not paid to the seller")

	pending, err := HasPendingTokenPackageTerminations()
	require.NoError(t, err)
	require.True(t, pending)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := RunPendingTokenPackageTerminations(ctx)
	require.NoError(t, err)
	assert.True(t, result.Done)
	assert.Equal(t, 2, result.Refunded, "one sweep refunds every terminated package")

	var storedBuyer model.User
	require.NoError(t, model.DB.First(&storedBuyer, buyer.Id).Error)
	assert.Equal(t, 100000, storedBuyer.Quota, "both unused packages are refunded in full")
	pending, err = HasPendingTokenPackageTerminations()
	require.NoError(t, err)
	assert.False(t, pending)
}
