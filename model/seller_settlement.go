package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// packageShare returns total * part / base rounded down. Money math stays in
// integer quota units; decimal only expresses the ratio so no float rounding
// ever moves a quota unit between the buyer, the seller and the platform.
func packageShare(total, part, base int64) int64 {
	if total <= 0 || part <= 0 || base <= 0 {
		return 0
	}
	if part > base {
		part = base
	}
	return decimal.NewFromInt(total).
		Mul(decimal.NewFromInt(part)).
		Div(decimal.NewFromInt(base)).
		Floor().IntPart()
}

// ReleaseEntitlementShare moves the seller's earned share for consumed quota
// from pending into the frozen ledger. Running it twice changes nothing because
// the target share is recomputed from amount_used and the already released
// amount.
func ReleaseEntitlementShare(entitlementId int, now int64, freezeDays int) (int64, error) {
	return releaseEntitlement(entitlementId, now, freezeDays, false)
}

// releaseEntitlementRemainingShare releases everything the seller has not been
// paid yet. Natural expiry releases the whole remaining share (D15): the buyer
// keeps nothing back and the platform keeps its commission.
func releaseEntitlementRemainingShare(entitlementId int, now int64, freezeDays int) (int64, error) {
	return releaseEntitlement(entitlementId, now, freezeDays, true)
}

func releaseEntitlement(entitlementId int, now int64, freezeDays int, full bool) (int64, error) {
	var released int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", entitlementId).First(&entitlement).Error; err != nil {
			return err
		}
		target := packageShare(entitlement.SellerQuotaTotal, entitlement.AmountUsed, entitlement.AmountTotal)
		if full {
			target = entitlement.SellerQuotaTotal
		}
		delta := target - entitlement.SellerQuotaReleased
		if delta <= 0 {
			return nil
		}
		availableAt := now + int64(freezeDays)*86400
		if err := tx.Model(&TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).
			Update("seller_quota_released", target).Error; err != nil {
			return err
		}
		profile, err := GetOrCreateSellerProfileWithTx(tx, entitlementSellerUserId(tx, entitlement))
		if err != nil {
			return err
		}
		if err := tx.Model(&SellerProfile{}).Where("id = ?", profile.Id).Updates(map[string]any{
			"pending_quota": gorm.Expr("CASE WHEN pending_quota >= ? THEN pending_quota - ? ELSE 0 END", delta, delta),
			"frozen_quota":  gorm.Expr("frozen_quota + ?", delta),
			"updated_at":    now,
		}).Error; err != nil {
			return err
		}
		entry := &SellerLedgerEntry{
			SellerUserId:  profile.UserId,
			EntitlementId: entitlement.Id,
			OrderId:       entitlement.OrderId,
			Type:          constant.SellerLedgerTypeRelease,
			Amount:        delta,
			AvailableAt:   availableAt,
			Status:        constant.SellerLedgerStatusFrozen,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		released = delta
		return nil
	})
	if err != nil {
		return 0, err
	}
	return released, nil
}

func entitlementSellerUserId(tx *gorm.DB, entitlement TokenPackageEntitlement) int {
	var sellerUserId int
	tx.Model(&TokenPackage{}).Select("seller_user_id").Where("id = ?", entitlement.PackageId).Scan(&sellerUserId)
	return sellerUserId
}

// SettleFrozenSellerEntries credits frozen seller shares whose freeze window has
// passed. Each entry is settled in its own transaction and the status change is
// conditional, so a repeated run cannot pay twice.
func SettleFrozenSellerEntries(now int64) (int, int64, error) {
	entries := make([]SellerLedgerEntry, 0)
	if err := DB.Where("type = ? AND status = ? AND available_at <= ?",
		constant.SellerLedgerTypeRelease, constant.SellerLedgerStatusFrozen, now).Order("id ASC").Find(&entries).Error; err != nil {
		return 0, 0, err
	}
	settledCount := 0
	var settledQuota int64
	for i := range entries {
		entry := entries[i]
		var amount int64
		err := DB.Transaction(func(tx *gorm.DB) error {
			var locked SellerLedgerEntry
			if err := lockForUpdate(tx).Where("id = ?", entry.Id).First(&locked).Error; err != nil {
				return err
			}
			if locked.Status != constant.SellerLedgerStatusFrozen {
				return nil
			}
			result := tx.Model(&SellerLedgerEntry{}).Where("id = ? AND status = ?", locked.Id, constant.SellerLedgerStatusFrozen).
				Update("status", constant.SellerLedgerStatusSettled)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return nil
			}
			if err := tx.Model(&User{}).Where("id = ?", locked.SellerUserId).
				Update("quota", gorm.Expr("quota + ?", locked.Amount)).Error; err != nil {
				return err
			}
			var profile SellerProfile
			if err := lockForUpdate(tx).Where("user_id = ?", locked.SellerUserId).First(&profile).Error; err != nil {
				return err
			}
			if err := tx.Model(&SellerProfile{}).Where("id = ?", profile.Id).Updates(map[string]any{
				"frozen_quota":        gorm.Expr("CASE WHEN frozen_quota >= ? THEN frozen_quota - ? ELSE 0 END", locked.Amount, locked.Amount),
				"settled_total_quota": gorm.Expr("settled_total_quota + ?", locked.Amount),
				"updated_at":          now,
			}).Error; err != nil {
				return err
			}
			settleEntry := &SellerLedgerEntry{
				SellerUserId:  locked.SellerUserId,
				EntitlementId: locked.EntitlementId,
				OrderId:       locked.OrderId,
				Type:          constant.SellerLedgerTypeSettle,
				Amount:        locked.Amount,
				Status:        constant.SellerLedgerStatusCompleted,
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if err := tx.Create(settleEntry).Error; err != nil {
				return err
			}
			amount = locked.Amount
			return nil
		})
		if err != nil {
			return settledCount, settledQuota, err
		}
		if amount > 0 {
			settledCount++
			settledQuota += amount
			if err := cacheIncrUserQuota(entry.SellerUserId, amount); err != nil {
				common.SysLog(common.LogText("failed to increase seller quota cache after settlement: %s", err.Error()))
			}
		}
	}
	return settledCount, settledQuota, nil
}

// ExpirePackageEntitlement closes an entitlement whose validity has passed. The
// buyer keeps nothing back and the platform keeps its commission: only the
// seller's unpaid share is released into the freeze queue (D15).
func ExpirePackageEntitlement(entitlementId int, now int64, freezeDays int) (int64, error) {
	var entitlement TokenPackageEntitlement
	if err := DB.Where("id = ?", entitlementId).First(&entitlement).Error; err != nil {
		return 0, err
	}
	if entitlement.EndTime > now {
		return 0, nil
	}
	if entitlement.Status != constant.TokenPackageEntitlementStatusActive &&
		entitlement.Status != constant.TokenPackageEntitlementStatusExhausted {
		return 0, nil
	}
	released, err := releaseEntitlementRemainingShare(entitlementId, now, freezeDays)
	if err != nil {
		return 0, err
	}
	err = DB.Model(&TokenPackageEntitlement{}).Where("id = ? AND status IN ?", entitlementId,
		[]string{constant.TokenPackageEntitlementStatusActive, constant.TokenPackageEntitlementStatusExhausted}).
		Updates(map[string]any{
			"status":     constant.TokenPackageEntitlementStatusExpired,
			"updated_at": now,
		}).Error
	return released, err
}

// PendingPreconsumeRequestIDs lists requests still holding package quota on an
// entitlement. Termination waits for them so their usage is priced before the
// refund is computed.
func PendingPreconsumeRequestIDs(entitlementId int) ([]string, error) {
	ids := make([]string, 0)
	err := DB.Model(&TokenPackagePreconsumeRecord{}).
		Where("entitlement_id = ? AND status = ?", entitlementId, constant.TokenPackagePreConsumePending).
		Pluck("request_id", &ids).Error
	return ids, err
}

// SettlePendingPreconsume closes an in-flight record at the already pre-consumed
// amount, used when a termination cannot wait any longer.
func SettlePendingPreconsume(requestId string) error {
	return SettlePackagePreconsume(requestId, 0)
}

// RefundTerminatedEntitlement refunds the unused part of one entitlement and
// closes it. The platform share is the difference between the total refund and
// the seller share, which keeps buyer + seller + platform exactly equal to the
// price paid.
func RefundTerminatedEntitlement(entitlementId int, now int64) (int64, error) {
	var refundTotal int64
	var refundedUserId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", entitlementId).First(&entitlement).Error; err != nil {
			return err
		}
		if entitlement.Status == constant.TokenPackageEntitlementStatusTerminated {
			return nil
		}
		remaining := entitlement.AmountTotal - entitlement.AmountUsed
		if remaining < 0 {
			remaining = 0
		}
		refundTotal = packageShare(entitlement.PaidQuota, remaining, entitlement.AmountTotal)
		// The seller refund is exactly what is still pending for this
		// entitlement: everything released already left pending, so the rest
		// must be what remains. Using the released amount instead of a second
		// ratio keeps the platform share from absorbing a rounding unit.
		sellerRefund := entitlement.SellerQuotaTotal - entitlement.SellerQuotaReleased
		if sellerRefund < 0 {
			sellerRefund = 0
		}
		if sellerRefund > refundTotal {
			sellerRefund = refundTotal
		}
		if refundTotal > 0 {
			if err := tx.Model(&User{}).Where("id = ?", entitlement.UserId).
				Update("quota", gorm.Expr("quota + ?", refundTotal)).Error; err != nil {
				return err
			}
		}
		var order TokenPackageOrder
		if err := tx.Where("id = ?", entitlement.OrderId).First(&order).Error; err == nil {
			orderUpdates := map[string]any{
				"refunded_quota": gorm.Expr("refunded_quota + ?", refundTotal),
				"status":         constant.TokenPackageOrderStatusRefunded,
				"updated_at":     now,
			}
			if err := tx.Model(&TokenPackageOrder{}).Where("id = ?", order.Id).Updates(orderUpdates).Error; err != nil {
				return err
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if sellerRefund > 0 {
			profile, err := GetOrCreateSellerProfileWithTx(tx, entitlementSellerUserId(tx, entitlement))
			if err != nil {
				return err
			}
			if err := tx.Model(&SellerProfile{}).Where("id = ?", profile.Id).Updates(map[string]any{
				"pending_quota": gorm.Expr("CASE WHEN pending_quota >= ? THEN pending_quota - ? ELSE 0 END", sellerRefund, sellerRefund),
				"updated_at":    now,
			}).Error; err != nil {
				return err
			}
			refundEntry := &SellerLedgerEntry{
				SellerUserId:  profile.UserId,
				EntitlementId: entitlement.Id,
				OrderId:       entitlement.OrderId,
				Type:          constant.SellerLedgerTypeRefund,
				Amount:        sellerRefund,
				Status:        constant.SellerLedgerStatusCompleted,
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if err := tx.Create(refundEntry).Error; err != nil {
				return err
			}
		}
		err := tx.Model(&TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).Updates(map[string]any{
			"status":         constant.TokenPackageEntitlementStatusTerminated,
			"refunded_quota": gorm.Expr("refunded_quota + ?", refundTotal),
			"updated_at":     now,
		}).Error
		if err != nil {
			return err
		}
		refundedUserId = entitlement.UserId
		return nil
	})
	if err != nil {
		return 0, err
	}
	if refundTotal > 0 {
		// The row is committed; the cache has to move with it or a buyer whose
		// balance lives in Redis keeps seeing the old one and is refused.
		if cacheErr := cacheIncrUserQuota(refundedUserId, refundTotal); cacheErr != nil {
			common.SysLog(common.LogText("failed to increase buyer quota cache after package refund: %s", cacheErr.Error()))
		}
	}
	return refundTotal, nil
}

// ListFrozenSellerLedgerEntries returns frozen entries for a seller, newest
// first, for the seller center ledger view.
func ListFrozenSellerLedgerEntries(sellerUserId, page, pageSize int) ([]SellerLedgerEntry, int64, error) {
	var total int64
	if err := DB.Model(&SellerLedgerEntry{}).Where("seller_user_id = ?", sellerUserId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	entries := make([]SellerLedgerEntry, 0)
	err := DB.Where("seller_user_id = ?", sellerUserId).Order("id DESC").
		Limit(pageSize).Offset((page - 1) * pageSize).Find(&entries).Error
	return entries, total, err
}

// SellerRevenueSummary is the seller center revenue header: money waiting to be
// released, money in the freeze window, money already paid out and lifetime
// sales.
type SellerRevenueSummary struct {
	PendingQuota      int64 `json:"pending_quota"`
	FrozenQuota       int64 `json:"frozen_quota"`
	SettledTotalQuota int64 `json:"settled_total_quota"`
	SalesCount        int64 `json:"sales_count"`
	SalesQuota        int64 `json:"sales_quota"`
}

// GetSellerRevenueSummary reads the seller's profile and lifetime orders.
func GetSellerRevenueSummary(sellerUserId int) (*SellerRevenueSummary, error) {
	summary := &SellerRevenueSummary{}
	profile, err := GetSellerProfileByUserId(sellerUserId)
	if err != nil {
		return nil, err
	}
	if profile != nil {
		summary.PendingQuota = profile.PendingQuota
		summary.FrozenQuota = profile.FrozenQuota
		summary.SettledTotalQuota = profile.SettledTotalQuota
	}
	salesQuery := DB.Model(&TokenPackageOrder{}).
		Joins("JOIN token_packages ON token_packages.id = token_package_orders.package_id").
		Where("token_packages.seller_user_id = ?", sellerUserId)
	if err := salesQuery.Count(&summary.SalesCount).Error; err != nil {
		return nil, err
	}
	var salesQuota struct{ Total int64 }
	if err := DB.Model(&TokenPackageOrder{}).
		Select("COALESCE(SUM(token_package_orders.price_quota), 0) AS total").
		Joins("JOIN token_packages ON token_packages.id = token_package_orders.package_id").
		Where("token_packages.seller_user_id = ?", sellerUserId).
		Scan(&salesQuota).Error; err != nil {
		return nil, err
	}
	summary.SalesQuota = salesQuota.Total
	return summary, nil
}
