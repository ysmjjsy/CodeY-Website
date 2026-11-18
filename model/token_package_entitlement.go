package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"gorm.io/gorm"
)

// TokenPackageEntitlement is one purchased package balance owned by a buyer.
// The snapshot columns freeze what the buyer paid for: an entitlement keeps
// serving with the models and multipliers recorded at purchase time even after
// the package publishes a new approved version.
type TokenPackageEntitlement struct {
	Id                  int    `json:"id"`
	UserId              int    `json:"user_id" gorm:"index;index:idx_token_package_entitlement_active,priority:1"`
	PackageId           int    `json:"package_id" gorm:"index;index:idx_token_package_entitlement_active,priority:2"`
	VersionId           int    `json:"version_id"`
	OrderId             int    `json:"order_id" gorm:"index"`
	BillingMode         string `json:"billing_mode" gorm:"type:varchar(32);default:'quota'"`
	ModelsSnapshot      string `json:"-" gorm:"type:text"`
	AmountTotal         int64  `json:"amount_total" gorm:"bigint;default:0"`
	AmountUsed          int64  `json:"amount_used" gorm:"bigint;default:0"`
	PaidQuota           int64  `json:"paid_quota" gorm:"bigint;default:0"`
	SellerQuotaTotal    int64  `json:"seller_quota_total" gorm:"bigint;default:0"`
	SellerQuotaReleased int64  `json:"seller_quota_released" gorm:"bigint;default:0"`
	CommissionQuota     int64  `json:"commission_quota" gorm:"bigint;default:0"`
	StartTime           int64  `json:"start_time"`
	EndTime             int64  `json:"end_time" gorm:"index:idx_token_package_entitlement_active,priority:4"`
	ExtendedSeconds     int64  `json:"extended_seconds"`
	NextResetTime       int64  `json:"next_reset_time"`
	PeriodUsed          int64  `json:"period_used"`
	Status              string `json:"status" gorm:"type:varchar(32);index;index:idx_token_package_entitlement_active,priority:3"`
	RefundedQuota       int64  `json:"refunded_quota" gorm:"bigint;default:0"`
	CreatedAt           int64  `json:"created_at"`
	UpdatedAt           int64  `json:"updated_at"`
}

var ErrTokenPackageEntitlementMissing = errors.New("token package entitlement not found")

func (entitlement *TokenPackageEntitlement) GetModelSpecs() ([]dto.TokenPackageModelSpec, error) {
	if entitlement.ModelsSnapshot == "" {
		return nil, nil
	}
	var specs []dto.TokenPackageModelSpec
	if err := common.UnmarshalJsonStr(entitlement.ModelsSnapshot, &specs); err != nil {
		return nil, err
	}
	return specs, nil
}

func (entitlement *TokenPackageEntitlement) SetModelSpecs(specs []dto.TokenPackageModelSpec) error {
	if len(specs) == 0 {
		entitlement.ModelsSnapshot = ""
		return nil
	}
	data, err := common.Marshal(specs)
	if err != nil {
		return err
	}
	entitlement.ModelsSnapshot = string(data)
	return nil
}

// AmountRemaining is the credit left on this entitlement. It is never negative:
// overdraft beyond the remaining credit settles at the request level and marks
// the entitlement exhausted.
func (entitlement *TokenPackageEntitlement) AmountRemaining() int64 {
	if entitlement.AmountUsed >= entitlement.AmountTotal {
		return 0
	}
	return entitlement.AmountTotal - entitlement.AmountUsed
}

func GetTokenPackageEntitlement(id int) (*TokenPackageEntitlement, error) {
	if id <= 0 {
		return nil, ErrTokenPackageEntitlementMissing
	}
	var entitlement TokenPackageEntitlement
	if err := DB.First(&entitlement, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTokenPackageEntitlementMissing
		}
		return nil, err
	}
	return &entitlement, nil
}

// HasActivePackageEntitlement answers the token-auth question: may this buyer
// use a package token right now? The authoritative remaining-credit check
// happens at pre-consume.
func HasActivePackageEntitlement(userId, packageId int) (bool, error) {
	if userId <= 0 || packageId <= 0 {
		return false, nil
	}
	var count int64
	err := DB.Model(&TokenPackageEntitlement{}).
		Where("user_id = ? AND package_id = ? AND status = ? AND end_time > ?",
			userId, packageId, constant.TokenPackageEntitlementStatusActive, common.GetTimestamp()).
		Count(&count).Error
	return count > 0, err
}

// GetServablePackageEntitlement returns the entitlement that should pay for the
// next request bound to this package: the active one that expires first and
// still carries credit.
func GetServablePackageEntitlement(userId, packageId int) (*TokenPackageEntitlement, error) {
	if userId <= 0 || packageId <= 0 {
		return nil, ErrTokenPackageEntitlementMissing
	}
	var entitlement TokenPackageEntitlement
	err := DB.Where("user_id = ? AND package_id = ? AND status = ? AND end_time > ? AND amount_used < amount_total",
		userId, packageId, constant.TokenPackageEntitlementStatusActive, common.GetTimestamp()).
		Order("end_time ASC, id ASC").
		First(&entitlement).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTokenPackageEntitlementMissing
		}
		return nil, err
	}
	return &entitlement, nil
}

func ListTokenPackageEntitlementsByUser(userId int) ([]*TokenPackageEntitlement, error) {
	entitlements := make([]*TokenPackageEntitlement, 0)
	if userId <= 0 {
		return entitlements, nil
	}
	err := DB.Where("user_id = ?", userId).Order("id DESC").Find(&entitlements).Error
	return entitlements, err
}

// ListActiveTokenPackageEntitlements is the settlement scan: every entitlement
// still serving or still owned by the seller's pending balance.
func ListActiveTokenPackageEntitlements() ([]*TokenPackageEntitlement, error) {
	entitlements := make([]*TokenPackageEntitlement, 0)
	err := DB.Where("status = ?", constant.TokenPackageEntitlementStatusActive).Find(&entitlements).Error
	return entitlements, err
}

func ListActiveTokenPackageEntitlementsByPackage(packageId int) ([]*TokenPackageEntitlement, error) {
	entitlements := make([]*TokenPackageEntitlement, 0)
	if packageId <= 0 {
		return entitlements, nil
	}
	err := DB.Where("package_id = ? AND status = ?", packageId, constant.TokenPackageEntitlementStatusActive).Find(&entitlements).Error
	return entitlements, err
}

// ListSettleableTokenPackageEntitlements returns entitlements that still owe the
// seller money: active ones and exhausted ones whose validity has not ended.
//
// Entitlements of a terminated package are left out: they are closed by the
// termination refund, and settling them here would expire them and pay the
// seller the share the buyer is owed back.
func ListSettleableTokenPackageEntitlements() ([]TokenPackageEntitlement, error) {
	entitlements := make([]TokenPackageEntitlement, 0)
	terminatedPackages := DB.Model(&TokenPackage{}).Select("id").Where("status = ?", constant.TokenPackageStatusTerminated)
	err := DB.Where("status IN ? AND package_id NOT IN (?)", openEntitlementStatuses(), terminatedPackages).
		Order("id ASC").Find(&entitlements).Error
	return entitlements, err
}

// openEntitlementStatuses are the states that still hold buyer credit or
// unreleased seller revenue.
func openEntitlementStatuses() []string {
	return []string{constant.TokenPackageEntitlementStatusActive, constant.TokenPackageEntitlementStatusExhausted}
}

// ListTerminatedPackageIdsWithOpenEntitlements finds terminated packages whose
// refunds have not finished, so a termination interrupted by a crash or a
// failure is picked up again.
func ListTerminatedPackageIdsWithOpenEntitlements() ([]int, error) {
	ids := make([]int, 0)
	terminatedPackages := DB.Model(&TokenPackage{}).Select("id").Where("status = ?", constant.TokenPackageStatusTerminated)
	err := DB.Model(&TokenPackageEntitlement{}).
		Where("status IN ? AND package_id IN (?)", openEntitlementStatuses(), terminatedPackages).
		Distinct("package_id").Order("package_id ASC").Pluck("package_id", &ids).Error
	return ids, err
}

// ListSettleableTokenPackageEntitlementsByPackage is the termination view: every
// entitlement that can still hold unreleased seller revenue.
func ListSettleableTokenPackageEntitlementsByPackage(packageId int) ([]TokenPackageEntitlement, error) {
	entitlements := make([]TokenPackageEntitlement, 0)
	err := DB.Where("package_id = ? AND status IN ?", packageId,
		[]string{constant.TokenPackageEntitlementStatusActive, constant.TokenPackageEntitlementStatusExhausted}).
		Order("id ASC").Find(&entitlements).Error
	return entitlements, err
}
