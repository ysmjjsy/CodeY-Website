package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// UserVerification stores minimized real-name verification status for a user.
// Plaintext ID numbers and ID photos are never persisted.
type UserVerification struct {
	Id              int    `json:"id" gorm:"primaryKey"`
	UserId          int    `json:"user_id" gorm:"uniqueIndex;not null"`
	Status          string `json:"status" gorm:"type:varchar(32);index;not null;default:'unverified'"`
	Provider        string `json:"provider" gorm:"type:varchar(64);default:''"`
	ProviderTraceId string `json:"provider_trace_id" gorm:"type:varchar(128);default:''"`
	MaskedName      string `json:"masked_name" gorm:"type:varchar(64);default:''"`
	IdNumberHash    string `json:"-" gorm:"type:varchar(128);index;default:''"`
	ReviewNote      string `json:"review_note" gorm:"type:varchar(512);default:''"`
	ReviewedBy      int    `json:"reviewed_by" gorm:"default:0"`
	ConsentAt       int64  `json:"consent_at" gorm:"bigint;default:0"`
	ConsentVersion  string `json:"consent_version" gorm:"type:varchar(64);default:''"`
	VerifiedAt      int64  `json:"verified_at" gorm:"bigint;default:0"`
	CreatedAt       int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

func GetUserVerificationByUserId(userId int) (*UserVerification, error) {
	if userId <= 0 {
		return nil, errors.New("user ID is empty")
	}
	var verification UserVerification
	err := DB.Where("user_id = ?", userId).First(&verification).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &verification, nil
}

func GetUserVerificationsByUserIds(userIds []int) (map[int]UserVerification, error) {
	result := make(map[int]UserVerification)
	if len(userIds) == 0 {
		return result, nil
	}
	var rows []UserVerification
	if err := DB.Where("user_id IN ?", userIds).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.UserId] = row
	}
	return result, nil
}

func UpsertUserVerification(v *UserVerification) error {
	if v == nil || v.UserId <= 0 {
		return errors.New("invalid user verification")
	}
	if v.Status == "" {
		v.Status = constant.UserVerificationStatusUnverified
	}
	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"status",
			"provider",
			"provider_trace_id",
			"masked_name",
			"id_number_hash",
			"review_note",
			"reviewed_by",
			"consent_at",
			"consent_version",
			"verified_at",
			"updated_at",
		}),
	}).Create(v).Error
}

func ListUserVerifications(status string, keyword string, page int, pageSize int) ([]UserVerification, int64, error) {
	query := DB.Model(&UserVerification{})
	if trimmedStatus := strings.TrimSpace(status); trimmedStatus != "" {
		query = query.Where("status = ?", trimmedStatus)
	}
	if trimmedKeyword := strings.TrimSpace(keyword); trimmedKeyword != "" {
		var userIDs []int
		like := "%" + trimmedKeyword + "%"
		if err := DB.Model(&User{}).Where("username LIKE ? OR email LIKE ?", like, like).Pluck("id", &userIDs).Error; err != nil {
			return nil, 0, err
		}
		if len(userIDs) > 0 {
			query = query.Where("user_id IN ? OR masked_name LIKE ? OR provider_trace_id LIKE ?", userIDs, like, like)
		} else {
			query = query.Where("masked_name LIKE ? OR provider_trace_id LIKE ?", like, like)
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
	// The pending queue is worked oldest first, so a buyer waiting to purchase
	// is not pushed back by newer submissions. Other views show recent changes first.
	order := "updated_at desc, id desc"
	if strings.TrimSpace(status) == constant.UserVerificationStatusPending {
		order = "updated_at asc, id asc"
	}
	var rows []UserVerification
	err := query.Order(order).Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error
	return rows, total, err
}

func DeleteUserVerificationByUserIdWithTx(tx *gorm.DB, userId int) error {
	if userId <= 0 {
		return nil
	}
	return tx.Unscoped().Where("user_id = ?", userId).Delete(&UserVerification{}).Error
}

// ReviewUserVerification completes a pending submission. The status condition
// makes a review idempotent and keeps it from overwriting a newer submission.
func ReviewUserVerification(userId int, reviewerId int, approved bool, note string) error {
	if userId <= 0 || reviewerId <= 0 {
		return errors.New("user ID is empty")
	}
	updates := map[string]any{
		"reviewed_by": reviewerId,
		"review_note": strings.TrimSpace(note),
		"updated_at":  common.GetTimestamp(),
	}
	if approved {
		updates["status"] = constant.UserVerificationStatusVerified
		updates["provider"] = "manual"
		updates["verified_at"] = common.GetTimestamp()
	} else {
		updates["status"] = constant.UserVerificationStatusRejected
		updates["verified_at"] = 0
	}
	result := DB.Model(&UserVerification{}).
		Where("user_id = ? AND status = ?", userId, constant.UserVerificationStatusPending).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrVerificationNotPending
	}
	return nil
}

// RevokeUserVerification withdraws an approved verification, for example when
// the identity later turns out to be wrong. The record becomes rejected with
// the reason, so the user sees why and can submit again.
func RevokeUserVerification(userId int, reviewerId int, note string) error {
	if userId <= 0 || reviewerId <= 0 {
		return errors.New("user ID is empty")
	}
	result := DB.Model(&UserVerification{}).
		Where("user_id = ? AND status = ?", userId, constant.UserVerificationStatusVerified).
		Updates(map[string]any{
			"status":      constant.UserVerificationStatusRejected,
			"reviewed_by": reviewerId,
			"review_note": strings.TrimSpace(note),
			"verified_at": 0,
			"updated_at":  common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrVerificationNotVerified
	}
	return nil
}

// ErrVerificationNotVerified reports a revoke attempt on a user who holds no
// approved verification.
var ErrVerificationNotVerified = errors.New("no approved verification to revoke")

// ErrVerificationNotPending reports a review attempt on a submission that is no
// longer waiting for review.
var ErrVerificationNotPending = errors.New("no verification submission is pending review")
