package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"gorm.io/gorm"
)

// TokenPackagePreconsumeRecord makes package quota movements replay-safe: every
// pre-consume reserves quota under the request id, and settle/refund adjust the
// same record exactly once.
type TokenPackagePreconsumeRecord struct {
	Id            int    `json:"id"`
	RequestId     string `json:"request_id" gorm:"uniqueIndex;type:varchar(64);not null"`
	EntitlementId int    `json:"entitlement_id" gorm:"index;not null"`
	Amount        int64  `json:"amount" gorm:"type:bigint;not null;default:0"`
	Status        string `json:"status" gorm:"type:varchar(32);index;default:'pending'"`
	CreatedAt     int64  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt     int64  `json:"updated_at" gorm:"autoUpdateTime"`
}

func (record *TokenPackagePreconsumeRecord) TableName() string {
	return "token_package_preconsume_records"
}

var ErrTokenPackagePreconsumeMissing = errors.New("token package preconsume record is missing")

// PreConsumePackageEntitlement reserves quota from one entitlement. The row lock
// serialises concurrent requests of the same buyer, so two in-flight requests
// can never both spend the last unit.
func PreConsumePackageEntitlement(entitlementId int, requestId string, amount int64) error {
	if entitlementId <= 0 || requestId == "" || amount < 0 {
		return ErrTokenPackageEntitlementMissing
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", entitlementId).First(&entitlement).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenPackageEntitlementMissing
			}
			return err
		}
		if entitlement.Status != constant.TokenPackageEntitlementStatusActive || entitlement.EndTime <= common.GetTimestamp() {
			return ErrTokenPackageEntitlementMissing
		}
		remaining := entitlement.AmountTotal - entitlement.AmountUsed
		// The reservation itself must fit. Overshoot is only tolerated when the
		// actual usage of an already admitted request exceeds its estimate.
		if remaining < amount {
			return ErrTokenPackageEntitlementMissing
		}
		record := TokenPackagePreconsumeRecord{
			RequestId:     requestId,
			EntitlementId: entitlementId,
			Amount:        amount,
			Status:        constant.TokenPackagePreConsumePending,
		}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		entitlement.AmountUsed += amount
		return tx.Model(&TokenPackageEntitlement{}).
			Where("id = ?", entitlementId).
			Update("amount_used", entitlement.AmountUsed).Error
	})
}

// AdjustPackageReservation changes the amount a request already reserved before
// it is sent upstream: a positive delta must fit in what the entitlement has
// left, a negative one returns part of the reservation. A request keeps a
// single record, so settlement and refund still act on the whole reservation.
func AdjustPackageReservation(requestId string, delta int64) error {
	if requestId == "" {
		return ErrTokenPackagePreconsumeMissing
	}
	if delta == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record TokenPackagePreconsumeRecord
		err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTokenPackagePreconsumeMissing
		}
		if err != nil {
			return err
		}
		if record.Status != constant.TokenPackagePreConsumePending {
			return ErrTokenPackagePreconsumeMissing
		}
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", record.EntitlementId).First(&entitlement).Error; err != nil {
			return err
		}
		if delta > 0 {
			if entitlement.Status != constant.TokenPackageEntitlementStatusActive || entitlement.EndTime <= common.GetTimestamp() {
				return ErrTokenPackageEntitlementMissing
			}
			if entitlement.AmountTotal-entitlement.AmountUsed < delta {
				return ErrTokenPackageEntitlementMissing
			}
		}
		// A release never returns more than this record reserved.
		delta = max(delta, -record.Amount)
		if err := tx.Model(&TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).
			Update("amount_used", max(entitlement.AmountUsed+delta, 0)).Error; err != nil {
			return err
		}
		return tx.Model(&TokenPackagePreconsumeRecord{}).Where("id = ?", record.Id).
			Update("amount", record.Amount+delta).Error
	})
}

// SettlePackagePreconsume applies the difference between the reserved and the
// actual charge. The entitlement may go past its total by one request's
// overshoot; that overshoot is recorded, never billed to wallet.
func SettlePackagePreconsume(requestId string, delta int64) error {
	if requestId == "" {
		return ErrTokenPackagePreconsumeMissing
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record TokenPackagePreconsumeRecord
		err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTokenPackagePreconsumeMissing
		}
		if err != nil {
			return err
		}
		if record.Status != constant.TokenPackagePreConsumePending {
			return nil
		}
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", record.EntitlementId).First(&entitlement).Error; err != nil {
			return err
		}
		entitlement.AmountUsed = max(entitlement.AmountUsed+delta, 0)
		status := entitlement.Status
		if entitlement.AmountUsed >= entitlement.AmountTotal && status == constant.TokenPackageEntitlementStatusActive {
			status = constant.TokenPackageEntitlementStatusExhausted
		}
		if err := tx.Model(&TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).
			Updates(map[string]any{"amount_used": entitlement.AmountUsed, "status": status}).Error; err != nil {
			return err
		}
		return tx.Model(&TokenPackagePreconsumeRecord{}).Where("id = ?", record.Id).
			Updates(map[string]any{
				"amount": record.Amount + delta,
				"status": constant.TokenPackagePreConsumeSettled,
			}).Error
	})
}

// RefundPackagePreconsume returns reserved quota after a failed request.
func RefundPackagePreconsume(requestId string) error {
	if requestId == "" {
		return ErrTokenPackagePreconsumeMissing
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record TokenPackagePreconsumeRecord
		err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrTokenPackagePreconsumeMissing
		}
		if err != nil {
			return err
		}
		if record.Status != constant.TokenPackagePreConsumePending {
			return nil
		}
		var entitlement TokenPackageEntitlement
		if err := lockForUpdate(tx).Where("id = ?", record.EntitlementId).First(&entitlement).Error; err != nil {
			return err
		}
		entitlement.AmountUsed = max(entitlement.AmountUsed-record.Amount, 0)
		status := entitlement.Status
		if status == constant.TokenPackageEntitlementStatusExhausted && entitlement.AmountUsed < entitlement.AmountTotal {
			status = constant.TokenPackageEntitlementStatusActive
		}
		if err := tx.Model(&TokenPackageEntitlement{}).Where("id = ?", entitlement.Id).
			Updates(map[string]any{"amount_used": entitlement.AmountUsed, "status": status}).Error; err != nil {
			return err
		}
		return tx.Model(&TokenPackagePreconsumeRecord{}).Where("id = ?", record.Id).
			Update("status", constant.TokenPackagePreConsumeRefunded).Error
	})
}

// CountPendingPackagePreconsume tells the termination path whether a request is
// still in flight for an entitlement.
func CountPendingPackagePreconsume(entitlementId int) (int64, error) {
	var count int64
	err := DB.Model(&TokenPackagePreconsumeRecord{}).
		Where("entitlement_id = ? AND status = ?", entitlementId, constant.TokenPackagePreConsumePending).
		Count(&count).Error
	return count, err
}
