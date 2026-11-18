package model

import (
	"github.com/QuantumNous/new-api/constant"
)

// TokenPackage represents a seller-listed token package product in the marketplace.
// Degraded omits a GORM boolean default tag for SQLite/MySQL/PostgreSQL parity.
type TokenPackage struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	SellerUserId    int    `json:"seller_user_id" gorm:"index;not null"`
	BillingMode     string `json:"billing_mode" gorm:"type:varchar(32);not null;default:'quota'"`
	Title           string `json:"title" gorm:"type:varchar(128);not null;default:''"`
	Subtitle        string `json:"subtitle" gorm:"type:varchar(256);default:''"`
	Description     string `json:"description" gorm:"type:text"`
	Status          string `json:"status" gorm:"type:varchar(32);index;not null;default:'draft'"`
	ActiveVersionId int    `json:"active_version_id" gorm:"index;default:0"`
	Degraded        bool   `json:"degraded" gorm:"not null"`
	CreatedAt       int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

var activeSellingPackageStatuses = []string{
	constant.TokenPackageStatusListed,
	constant.TokenPackageStatusPaused,
}

// StopActivePackagesBySeller transitions all listed or paused packages of a
// seller to stopped when the seller loses publishing eligibility.
func StopActivePackagesBySeller(sellerUserId int) (int64, error) {
	if sellerUserId <= 0 {
		return 0, nil
	}
	res := DB.Model(&TokenPackage{}).
		Where("seller_user_id = ? AND status IN ?", sellerUserId, activeSellingPackageStatuses).
		Update("status", constant.TokenPackageStatusStopped)
	return res.RowsAffected, res.Error
}

// ListActivePackageSellerIDs returns distinct seller user IDs that currently
// have listed or paused packages.
func ListActivePackageSellerIDs() ([]int, error) {
	var sellerIDs []int
	err := DB.Model(&TokenPackage{}).
		Where("status IN ?", activeSellingPackageStatuses).
		Distinct("seller_user_id").
		Pluck("seller_user_id", &sellerIDs).Error
	return sellerIDs, err
}

// StopPackagesBySellerIDs transitions all listed or paused packages owned by
// the given sellers to stopped.
func StopPackagesBySellerIDs(sellerUserIDs []int) (int64, error) {
	if len(sellerUserIDs) == 0 {
		return 0, nil
	}
	res := DB.Model(&TokenPackage{}).
		Where("seller_user_id IN ? AND status IN ?", sellerUserIDs, activeSellingPackageStatuses).
		Update("status", constant.TokenPackageStatusStopped)
	return res.RowsAffected, res.Error
}

// ListMarketPackages lists packages currently on sale, newest first. Only the
// listed state is purchasable; stopped and paused packages stay out of the
// marketplace even while they keep serving sold entitlements.
func ListMarketPackages(page, pageSize int, keyword, modelName string) ([]TokenPackage, int64, error) {
	query := DB.Model(&TokenPackage{}).
		Where("status = ? AND active_version_id > 0", constant.TokenPackageStatusListed)
	if keyword != "" {
		query = query.Where("title LIKE ?", "%"+keyword+"%")
	}
	if modelName != "" {
		sub := DB.Model(&TokenPackageVersion{}).
			Select("package_id").
			Where("status = ?", constant.TokenPackageVersionStatusApproved).
			Where("models LIKE ?", "%\""+modelName+"\"%")
		query = query.Where("id IN (?)", sub)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	packages := make([]TokenPackage, 0)
	err := query.Order("id DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&packages).Error
	return packages, total, err
}
