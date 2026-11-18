package service

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSellerEligibilityTest(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := model.DB
	previousOptions := config.GlobalConfig.ExportAllConfigs()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserVerification{}, &model.SellerProfile{}, &model.TokenPackage{}))
	model.DB = db
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		token_package_setting.KeySellerGroups:  `["vip","svip"]`,
		token_package_setting.KeyCommissionBps: "1000",
	}))

	t.Cleanup(func() {
		model.DB = originalDB
		require.NoError(t, config.GlobalConfig.LoadFromDB(previousOptions))
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func createEligibilityUser(t *testing.T, username, group string, role int) *model.User {
	t.Helper()
	user := &model.User{Username: username, Group: group, Role: role, Status: common.UserStatusEnabled, AffCode: "aff-" + username}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

func TestSellerEligibilityMatrix(t *testing.T) {
	setupSellerEligibilityTest(t)

	unverified := createEligibilityUser(t, "unverified", "default", common.RoleCommonUser)
	eligibility, err := EvaluateSellerEligibility(unverified.Id)
	require.NoError(t, err)
	assert.False(t, eligibility.Eligible)
	assert.Equal(t, SellerReasonNeedVerification, eligibility.Reason)
	assert.Equal(t, constant.UserVerificationStatusUnverified, eligibility.VerificationStatus)

	notInGroup := createEligibilityUser(t, "not-in-group", "default", common.RoleCommonUser)
	require.NoError(t, model.UpsertUserVerification(&model.UserVerification{
		UserId: notInGroup.Id, Status: constant.UserVerificationStatusVerified, Provider: "manual",
	}))
	eligibility, err = EvaluateSellerEligibility(notInGroup.Id)
	require.NoError(t, err)
	assert.False(t, eligibility.Eligible)
	assert.True(t, eligibility.Verified)
	assert.Equal(t, SellerReasonNotAuthorized, eligibility.Reason)

	eligible := createEligibilityUser(t, "eligible", "vip", common.RoleCommonUser)
	require.NoError(t, model.UpsertUserVerification(&model.UserVerification{
		UserId: eligible.Id, Status: constant.UserVerificationStatusVerified, Provider: "manual",
	}))
	eligibility, err = EvaluateSellerEligibility(eligible.Id)
	require.NoError(t, err)
	assert.True(t, eligibility.Eligible)
	assert.Empty(t, eligibility.Reason)
	assert.Equal(t, 1000, eligibility.EffectiveCommissionBps)

	admin := createEligibilityUser(t, "operator", "default", common.RoleAdminUser)
	eligibility, err = EvaluateSellerEligibility(admin.Id)
	require.NoError(t, err)
	assert.True(t, eligibility.Eligible, "administrators bypass the verification and group gates")

	unbanned := false
	_, err = model.UpdateSellerProfileAdmin(eligible.Id, &unbanned, new(string), nil, false)
	require.NoError(t, err)
	banned := true
	profile, err := model.UpdateSellerProfileAdmin(eligible.Id, &banned, new(string), nil, false)
	require.NoError(t, err)
	assert.True(t, profile.PublishBanned)
	eligibility, err = EvaluateSellerEligibility(eligible.Id)
	require.NoError(t, err)
	assert.False(t, eligibility.Eligible)
	assert.Equal(t, SellerReasonBanned, eligibility.Reason)
}

func TestSellerCommissionOverrideAndListingStop(t *testing.T) {
	setupSellerEligibilityTest(t)

	seller := createEligibilityUser(t, "seller", "svip", common.RoleCommonUser)
	require.NoError(t, model.UpsertUserVerification(&model.UserVerification{
		UserId: seller.Id, Status: constant.UserVerificationStatusVerified, Provider: "manual",
	}))

	override := 2500
	_, err := model.UpdateSellerProfileAdmin(seller.Id, nil, new(string), &override, false)
	require.NoError(t, err)
	eligibility, err := EvaluateSellerEligibility(seller.Id)
	require.NoError(t, err)
	assert.True(t, eligibility.Eligible)
	assert.Equal(t, 2500, eligibility.EffectiveCommissionBps)

	require.NoError(t, model.DB.Create(&model.TokenPackage{
		SellerUserId: seller.Id, BillingMode: constant.TokenPackageBillingModeQuota, Title: "Listing", Status: constant.TokenPackageStatusListed,
	}).Error)
	stopped, err := StopIneligibleSellerPackages(seller.Id)
	require.NoError(t, err)
	assert.Zero(t, stopped, "an eligible seller keeps selling")

	// Revoking verification stops the active listing on the next evaluation.
	require.NoError(t, model.UpsertUserVerification(&model.UserVerification{
		UserId: seller.Id, Status: constant.UserVerificationStatusRejected, Provider: "manual",
	}))
	stopped, err = StopIneligibleSellerPackages(seller.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1, stopped)
}
