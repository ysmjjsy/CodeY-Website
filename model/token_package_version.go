package model

import (
	"errors"

	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
)

var (
	ErrTokenPackageNotFound       = errors.New("token package not found")
	ErrTokenPackageVersionMissing = errors.New("token package version not found")
	ErrTokenPackageVersionState   = errors.New("token package version is not in the required state")
	ErrTokenPackageState          = errors.New("token package is not in the required state")
)

// TokenPackageVersion is one immutable proposal of models, multipliers, SKUs,
// and channel bindings. Only an approved version can serve traffic and sales.
type TokenPackageVersion struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	PackageId   int    `json:"package_id" gorm:"not null;uniqueIndex:idx_token_package_version_no"`
	VersionNo   int    `json:"version_no" gorm:"not null;default:1;uniqueIndex:idx_token_package_version_no"`
	Status      string `json:"status" gorm:"type:varchar(32);index;not null;default:'draft'"`
	Models      string `json:"-" gorm:"type:text"`
	SKUs        string `json:"-" gorm:"type:text"`
	TestReport  string `json:"-" gorm:"type:text"`
	SubmittedAt int64  `json:"submitted_at"`
	ReviewedBy  int    `json:"reviewed_by"`
	ReviewedAt  int64  `json:"reviewed_at"`
	ReviewNote  string `json:"review_note" gorm:"type:varchar(512)"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;autoCreateTime"`
	UpdatedAt   int64  `json:"updated_at" gorm:"bigint;autoUpdateTime"`
}

// TokenPackageChannel binds one channel-owned upstream to a version and lists
// the subset of the version's models it serves.
type TokenPackageChannel struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	VersionId int    `json:"version_id" gorm:"not null;uniqueIndex:idx_token_package_version_channel"`
	ChannelId int    `json:"channel_id" gorm:"not null;uniqueIndex:idx_token_package_version_channel"`
	Models    string `json:"-" gorm:"type:text"`
	Priority  int64  `json:"priority" gorm:"default:0"`
	Weight    uint   `json:"weight" gorm:"default:1"`
}

func (version *TokenPackageVersion) GetModelSpecs() []dto.TokenPackageModelSpec {
	specs := make([]dto.TokenPackageModelSpec, 0)
	if version.Models == "" {
		return specs
	}
	if err := common.UnmarshalJsonStr(version.Models, &specs); err != nil {
		return make([]dto.TokenPackageModelSpec, 0)
	}
	return specs
}

func (version *TokenPackageVersion) SetModelSpecs(specs []dto.TokenPackageModelSpec) error {
	encoded, err := common.Marshal(specs)
	if err != nil {
		return err
	}
	version.Models = string(encoded)
	return nil
}

func (version *TokenPackageVersion) GetSKUList() []dto.TokenPackageSKU {
	skus := make([]dto.TokenPackageSKU, 0)
	if version.SKUs == "" {
		return skus
	}
	if err := common.UnmarshalJsonStr(version.SKUs, &skus); err != nil {
		return make([]dto.TokenPackageSKU, 0)
	}
	return skus
}

func (version *TokenPackageVersion) SetSKUList(skus []dto.TokenPackageSKU) error {
	encoded, err := common.Marshal(skus)
	if err != nil {
		return err
	}
	version.SKUs = string(encoded)
	return nil
}

func (version *TokenPackageVersion) GetTestReport() *dto.TokenPackageTestReport {
	if version.TestReport == "" {
		return nil
	}
	report := &dto.TokenPackageTestReport{}
	if err := common.UnmarshalJsonStr(version.TestReport, report); err != nil {
		return nil
	}
	return report
}

func (version *TokenPackageVersion) SetTestReport(report *dto.TokenPackageTestReport) error {
	encoded, err := common.Marshal(report)
	if err != nil {
		return err
	}
	version.TestReport = string(encoded)
	return nil
}

func (binding *TokenPackageChannel) GetModels() []string {
	models := make([]string, 0)
	if binding.Models == "" {
		return models
	}
	if err := common.UnmarshalJsonStr(binding.Models, &models); err != nil {
		return make([]string, 0)
	}
	return models
}

func (binding *TokenPackageChannel) SetModels(models []string) error {
	encoded, err := common.Marshal(models)
	if err != nil {
		return err
	}
	binding.Models = string(encoded)
	return nil
}

func GetTokenPackageById(id int) (*TokenPackage, error) {
	pkg := &TokenPackage{}
	err := DB.Where("id = ?", id).First(pkg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenPackageNotFound
	}
	if err != nil {
		return nil, err
	}
	return pkg, nil
}

func GetTokenPackageForSeller(id, sellerUserId int) (*TokenPackage, error) {
	pkg := &TokenPackage{}
	err := DB.Where("id = ? AND seller_user_id = ?", id, sellerUserId).First(pkg).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenPackageNotFound
	}
	if err != nil {
		return nil, err
	}
	return pkg, nil
}

func ListTokenPackagesBySeller(sellerUserId int) ([]*TokenPackage, error) {
	packages := make([]*TokenPackage, 0)
	err := DB.Where("seller_user_id = ?", sellerUserId).Order("id desc").Find(&packages).Error
	return packages, err
}

func CreateTokenPackage(pkg *TokenPackage) error {
	if pkg.BillingMode == "" {
		pkg.BillingMode = constant.TokenPackageBillingModeQuota
	}
	if pkg.Status == "" {
		pkg.Status = constant.TokenPackageStatusDraft
	}
	return DB.Create(pkg).Error
}

// UpdateTokenPackageDetails writes the seller-editable product copy. A
// terminated package is historical and never changes again.
func UpdateTokenPackageDetails(id, sellerUserId int, title, subtitle, description string) (*TokenPackage, error) {
	res := DB.Model(&TokenPackage{}).
		Where("id = ? AND seller_user_id = ? AND status <> ?", id, sellerUserId, constant.TokenPackageStatusTerminated).
		Updates(map[string]any{"title": title, "subtitle": subtitle, "description": description})
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrTokenPackageNotFound
	}
	return GetTokenPackageForSeller(id, sellerUserId)
}

// StopTokenPackage delists a package. Sold entitlements keep serving.
func StopTokenPackage(id, sellerUserId int) (*TokenPackage, error) {
	res := DB.Model(&TokenPackage{}).
		Where("id = ? AND seller_user_id = ? AND status IN ?", id, sellerUserId, activeSellingPackageStatuses).
		Update("status", constant.TokenPackageStatusStopped)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrTokenPackageState
	}
	return GetTokenPackageForSeller(id, sellerUserId)
}

// SetTokenPackageStatus applies an admin transition from one of the allowed
// source states.
func SetTokenPackageStatus(id int, from []string, to string) (*TokenPackage, error) {
	res := DB.Model(&TokenPackage{}).Where("id = ? AND status IN ?", id, from).Update("status", to)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrTokenPackageState
	}
	return GetTokenPackageById(id)
}

func SetTokenPackageDegraded(id int, degraded bool) error {
	return DB.Model(&TokenPackage{}).Where("id = ?", id).Update("degraded", degraded).Error
}

func ListVersionsByPackage(packageId int) ([]*TokenPackageVersion, error) {
	versions := make([]*TokenPackageVersion, 0)
	err := DB.Where("package_id = ?", packageId).Order("version_no desc").Find(&versions).Error
	return versions, err
}

func GetTokenPackageVersion(id int) (*TokenPackageVersion, error) {
	version := &TokenPackageVersion{}
	err := DB.Where("id = ?", id).First(version).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenPackageVersionMissing
	}
	if err != nil {
		return nil, err
	}
	return version, nil
}

func GetLatestTokenPackageVersion(packageId int) (*TokenPackageVersion, error) {
	version := &TokenPackageVersion{}
	err := DB.Where("package_id = ?", packageId).Order("version_no desc").Limit(1).Find(version).Error
	if err != nil {
		return nil, err
	}
	if version.Id == 0 {
		return nil, ErrTokenPackageVersionMissing
	}
	return version, nil
}

// GetApprovedTokenPackageVersion returns the version currently backing the
// package, if any.
func GetApprovedTokenPackageVersion(pkg *TokenPackage) (*TokenPackageVersion, error) {
	if pkg.ActiveVersionId <= 0 {
		return nil, ErrTokenPackageVersionMissing
	}
	version, err := GetTokenPackageVersion(pkg.ActiveVersionId)
	if err != nil {
		return nil, err
	}
	if version.Status != constant.TokenPackageVersionStatusApproved {
		return nil, ErrTokenPackageVersionMissing
	}
	return version, nil
}

func GetVersionChannels(versionId int) ([]*TokenPackageChannel, error) {
	bindings := make([]*TokenPackageChannel, 0)
	err := DB.Where("version_id = ?", versionId).Order("priority desc, id asc").Find(&bindings).Error
	return bindings, err
}

// CreateTokenPackageVersion stores a new draft version with its channel
// bindings. The package row lock serializes version numbering.
func CreateTokenPackageVersion(packageId int, version *TokenPackageVersion, bindings []TokenPackageChannel) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		pkg := &TokenPackage{}
		if err := lockForUpdate(tx).Where("id = ?", packageId).First(pkg).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenPackageNotFound
			}
			return err
		}
		if pkg.Status == constant.TokenPackageStatusTerminated {
			return ErrTokenPackageState
		}
		var latest int
		if err := tx.Model(&TokenPackageVersion{}).Where("package_id = ?", packageId).
			Select("COALESCE(MAX(version_no), 0)").Scan(&latest).Error; err != nil {
			return err
		}
		version.PackageId = packageId
		version.VersionNo = latest + 1
		version.Status = constant.TokenPackageVersionStatusDraft
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		for i := range bindings {
			bindings[i].VersionId = version.Id
			bindings[i].Id = 0
		}
		if len(bindings) > 0 {
			if err := tx.Create(&bindings).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// UpdateTokenPackageVersionStatus moves a version out of one of the source
// states. extra holds column updates applied in the same statement.
func UpdateTokenPackageVersionStatus(versionId int, from []string, to string, extra map[string]any) (bool, error) {
	updates := map[string]any{"status": to}
	for key, value := range extra {
		updates[key] = value
	}
	res := DB.Model(&TokenPackageVersion{}).Where("id = ? AND status IN ?", versionId, from).Updates(updates)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// ApproveTokenPackageVersion promotes a reviewed version, supersedes the
// previous one, and points the package at the new snapshot. A draft package
// starts selling; a stopped package stays stopped until the seller relists it.
func ApproveTokenPackageVersion(versionId, reviewerId int, note string) (*TokenPackageVersion, error) {
	approved := &TokenPackageVersion{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		version := &TokenPackageVersion{}
		if err := lockForUpdate(tx).Where("id = ?", versionId).First(version).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenPackageVersionMissing
			}
			return err
		}
		if version.Status != constant.TokenPackageVersionStatusPendingReview {
			return ErrTokenPackageVersionState
		}
		pkg := &TokenPackage{}
		if err := lockForUpdate(tx).Where("id = ?", version.PackageId).First(pkg).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenPackageNotFound
			}
			return err
		}
		if pkg.Status == constant.TokenPackageStatusTerminated {
			return ErrTokenPackageState
		}
		if err := tx.Model(&TokenPackageVersion{}).
			Where("package_id = ? AND status = ? AND id <> ?", pkg.Id, constant.TokenPackageVersionStatusApproved, version.Id).
			Update("status", constant.TokenPackageVersionStatusSuperseded).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if err := tx.Model(version).Updates(map[string]any{
			"status":      constant.TokenPackageVersionStatusApproved,
			"reviewed_by": reviewerId,
			"reviewed_at": now,
			"review_note": note,
		}).Error; err != nil {
			return err
		}
		packageStatus := pkg.Status
		if packageStatus == constant.TokenPackageStatusDraft {
			packageStatus = constant.TokenPackageStatusListed
		}
		if err := tx.Model(pkg).Updates(map[string]any{
			"active_version_id": version.Id,
			"status":            packageStatus,
		}).Error; err != nil {
			return err
		}
		version.Status = constant.TokenPackageVersionStatusApproved
		version.ReviewedBy = reviewerId
		version.ReviewedAt = now
		version.ReviewNote = note
		approved = version
		// The package routing index is rebuilt with the channel cache. Bumping
		// the channel topic in the same transaction makes every node reload it,
		// so a newly listed package is routable and a switched version stops
		// routing to channels it no longer binds.
		return bumpSyncTopic(tx, SyncTopicChannels)
	})
	if err != nil {
		return nil, err
	}
	return approved, nil
}

func RejectTokenPackageVersion(versionId, reviewerId int, note string) (*TokenPackageVersion, error) {
	version, err := GetTokenPackageVersion(versionId)
	if err != nil {
		return nil, err
	}
	ok, err := UpdateTokenPackageVersionStatus(versionId, []string{constant.TokenPackageVersionStatusPendingReview}, constant.TokenPackageVersionStatusRejected, map[string]any{
		"reviewed_by": reviewerId,
		"reviewed_at": common.GetTimestamp(),
		"review_note": note,
	})
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrTokenPackageVersionState
	}
	return GetTokenPackageVersion(version.Id)
}

// ListTestingTokenPackageVersionIds returns the versions waiting for their
// connection check, oldest first.
func ListTestingTokenPackageVersionIds() ([]int, error) {
	ids := make([]int, 0)
	err := DB.Model(&TokenPackageVersion{}).Where("status = ?", constant.TokenPackageVersionStatusTesting).
		Order("id ASC").Pluck("id", &ids).Error
	return ids, err
}

// ListPendingReviewVersions returns the admin review queue: submitted versions
// whose package still sells or is being prepared.
func ListPendingReviewVersions(page, pageSize int) ([]*TokenPackageVersion, int64, error) {
	query := DB.Model(&TokenPackageVersion{}).Where("status = ?", constant.TokenPackageVersionStatusPendingReview)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	versions := make([]*TokenPackageVersion, 0)
	err := query.Order("submitted_at asc, id asc").Limit(pageSize).Offset((page - 1) * pageSize).Find(&versions).Error
	return versions, total, err
}

// IsChannelBoundToActivePackage reports whether an approved version of a
// non-terminated package currently routes through the channel. Such a channel
// cannot be deleted or have its endpoint shape changed; the seller must submit
// a version that no longer binds it first.
// lockedPackageVersionStatuses are the versions whose bound channels a seller
// can no longer reshape. A version waiting for review has already passed the
// connection check against the channel as it was; editing the channel before the
// reviewer looks at it would make the review describe a different upstream.
func lockedPackageVersionStatuses() []string {
	return []string{
		constant.TokenPackageVersionStatusTesting,
		constant.TokenPackageVersionStatusPendingReview,
		constant.TokenPackageVersionStatusApproved,
	}
}

func IsChannelBoundToActivePackage(channelId int) (bool, error) {
	if channelId <= 0 {
		return false, nil
	}
	var count int64
	err := DB.Table("token_package_channels AS c").
		Joins("JOIN token_package_versions AS v ON v.id = c.version_id AND v.status IN ?", lockedPackageVersionStatuses()).
		Joins("JOIN token_packages AS p ON p.id = v.package_id AND p.status <> ? AND (p.active_version_id = v.id OR v.status <> ?)", constant.TokenPackageStatusTerminated, constant.TokenPackageVersionStatusApproved).
		Where("c.channel_id = ?", channelId).
		Count(&count).Error
	return count > 0, err
}

// ListPackageTitlesBoundToChannels returns the titles of packages whose active
// version binds any of the given channels, grouped by channel id.
func ListPackageTitlesBoundToChannels(channelIds []int) (map[int][]string, error) {
	result := make(map[int][]string, len(channelIds))
	if len(channelIds) == 0 {
		return result, nil
	}
	type bindingRow struct {
		ChannelId int
		Title     string
	}
	rows := make([]bindingRow, 0)
	err := DB.Table("token_package_channels AS c").
		Select("c.channel_id AS channel_id, p.title AS title").
		Joins("JOIN token_package_versions AS v ON v.id = c.version_id AND v.status IN ?", lockedPackageVersionStatuses()).
		Joins("JOIN token_packages AS p ON p.id = v.package_id AND p.status <> ? AND (p.active_version_id = v.id OR v.status <> ?)", constant.TokenPackageStatusTerminated, constant.TokenPackageVersionStatusApproved).
		Where("c.channel_id IN ?", channelIds).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ChannelId] = append(result[row.ChannelId], row.Title)
	}
	return result, nil
}

// GetTokenPackageVersionTx reads a version inside an existing transaction.
func GetTokenPackageVersionTx(tx *gorm.DB, id int) (*TokenPackageVersion, error) {
	var version TokenPackageVersion
	if err := tx.Where("id = ?", id).First(&version).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTokenPackageVersionMissing
		}
		return nil, err
	}
	return &version, nil
}
