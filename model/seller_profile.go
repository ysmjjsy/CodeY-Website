package model

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SellerProfile stores per-seller marketplace status, commission override, and
// summarized ledger balances. PublishBanned intentionally omits a GORM boolean
// default tag for SQLite/MySQL/PostgreSQL parity.
type SellerProfile struct {
	Id                    int    `json:"id" gorm:"primaryKey"`
	UserId                int    `json:"user_id" gorm:"uniqueIndex;not null"`
	PublishBanned         bool   `json:"publish_banned" gorm:"not null"`
	BanReason             string `json:"ban_reason" gorm:"type:varchar(512);default:''"`
	CommissionBpsOverride *int   `json:"commission_bps_override" gorm:"default:null"`
	PendingQuota          int64  `json:"pending_quota" gorm:"bigint;not null;default:0"`
	FrozenQuota           int64  `json:"frozen_quota" gorm:"bigint;not null;default:0"`
	SettledTotalQuota     int64  `json:"settled_total_quota" gorm:"bigint;not null;default:0"`
	CreatedAt             int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt             int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

func GetSellerProfileByUserId(userId int) (*SellerProfile, error) {
	if userId <= 0 {
		return nil, errors.New("user ID is empty")
	}
	var profile SellerProfile
	err := DB.Where("user_id = ?", userId).First(&profile).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &profile, nil
}

func GetOrCreateSellerProfileWithTx(tx *gorm.DB, userId int) (*SellerProfile, error) {
	if userId <= 0 {
		return nil, errors.New("user ID is empty")
	}
	var profile SellerProfile
	err := tx.Where("user_id = ?", userId).First(&profile).Error
	if err == nil {
		return &profile, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	profile = SellerProfile{UserId: userId, PublishBanned: false}
	if err := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoNothing: true,
	}).Create(&profile).Error; err != nil {
		return nil, err
	}
	if err := tx.Where("user_id = ?", userId).First(&profile).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func UpdateSellerProfileAdmin(userId int, publishBanned *bool, banReason *string, commissionBpsOverride *int, clearCommission bool) (*SellerProfile, error) {
	if userId <= 0 {
		return nil, errors.New("user ID is empty")
	}
	var updated SellerProfile
	err := DB.Transaction(func(tx *gorm.DB) error {
		profile, err := GetOrCreateSellerProfileWithTx(tx, userId)
		if err != nil {
			return err
		}
		updates := map[string]any{}
		if publishBanned != nil {
			updates["publish_banned"] = *publishBanned
			if !*publishBanned && banReason == nil {
				updates["ban_reason"] = ""
			}
		}
		if banReason != nil {
			updates["ban_reason"] = strings.TrimSpace(*banReason)
		}
		if clearCommission {
			updates["commission_bps_override"] = nil
		} else if commissionBpsOverride != nil {
			updates["commission_bps_override"] = *commissionBpsOverride
		}
		if len(updates) > 0 {
			if err := tx.Model(&SellerProfile{}).Where("id = ?", profile.Id).Updates(updates).Error; err != nil {
				return err
			}
		}
		return tx.Where("id = ?", profile.Id).First(&updated).Error
	})
	if err != nil {
		return nil, err
	}
	return &updated, nil
}

func ListSellerProfiles(page, pageSize int, keyword string, bannedOnly *bool) ([]SellerProfile, int64, error) {
	query := DB.Model(&SellerProfile{})
	if bannedOnly != nil {
		query = query.Where("publish_banned = ?", *bannedOnly)
	}
	if trimmedKeyword := strings.TrimSpace(keyword); trimmedKeyword != "" {
		var userIDs []int
		like := "%" + trimmedKeyword + "%"
		if err := DB.Model(&User{}).Where("username LIKE ? OR email LIKE ?", like, like).Pluck("id", &userIDs).Error; err != nil {
			return nil, 0, err
		}
		if len(userIDs) > 0 {
			query = query.Where("user_id IN ? OR ban_reason LIKE ?", userIDs, like)
		} else {
			query = query.Where("ban_reason LIKE ?", like)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	var rows []SellerProfile
	err := query.Order("updated_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error
	return rows, total, err
}
