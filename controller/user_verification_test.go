package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupBuyerVerificationTest gives each case its own in-memory database with
// the user and verification tables, and one seller group configured.
func setupBuyerVerificationTest(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := model.DB
	previousOptions := config.GlobalConfig.ExportAllConfigs()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserVerification{}, &model.AuditLog{}, &model.TokenPackage{}, &model.SellerProfile{}))
	previousLogDB, previousRedis := model.LOG_DB, common.RedisEnabled
	model.DB = db
	model.LOG_DB = db
	// Audit records look up the operator name, which reads Redis when enabled.
	common.RedisEnabled = false
	t.Cleanup(func() { model.LOG_DB, common.RedisEnabled = previousLogDB, previousRedis })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		token_package_setting.KeySellerGroups: `["vip"]`,
	}))

	t.Cleanup(func() {
		model.DB = originalDB
		require.NoError(t, config.GlobalConfig.LoadFromDB(previousOptions))
		if sqlDB, err := db.DB(); err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func callVerificationHandler(t *testing.T, userId int, handler gin.HandlerFunc, target string) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", userId)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	handler(c)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	return payload
}

func TestUnverifiedBuyerPurchaseErrorCarriesAStableCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/market/packages/1/purchase", nil)

	writePackagePurchaseError(c, model.ErrPackageBuyerUnverified)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload))
	assert.Equal(t, false, payload["success"])
	assert.Equal(t, PackageBuyerUnverifiedCode, payload["code"], "the console opens the verification guide on this code")
	assert.NotEmpty(t, payload["message"])
}

func TestOwnVerificationShowsTheReasonOnlyWhenRejected(t *testing.T) {
	db := setupBuyerVerificationTest(t)
	require.NoError(t, db.Create(&model.UserVerification{UserId: 1, Status: constant.UserVerificationStatusRejected, MaskedName: "张*", ReviewNote: "name does not match"}).Error)
	require.NoError(t, db.Create(&model.UserVerification{UserId: 2, Status: constant.UserVerificationStatusPending, MaskedName: "李*", ReviewNote: "internal note"}).Error)

	rejected := callVerificationHandler(t, 1, GetUserVerification, "/api/user/verification")
	require.Equal(t, true, rejected["success"])
	assert.Equal(t, "name does not match", rejected["data"].(map[string]any)["review_note"])

	pending := callVerificationHandler(t, 2, GetUserVerification, "/api/user/verification")
	require.Equal(t, true, pending["success"])
	_, hasNote := pending["data"].(map[string]any)["review_note"]
	assert.False(t, hasNote, "a pending submission exposes no reviewer note")
}

func TestPendingReviewQueueListsOldestFirstAndMarksSellerGroups(t *testing.T) {
	db := setupBuyerVerificationTest(t)
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "buyer", AffCode: "aff-buyer", Group: "default", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "seller", AffCode: "aff-seller", Group: "vip", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&model.UserVerification{UserId: 1, Status: constant.UserVerificationStatusPending, UpdatedAt: 200}).Error)
	require.NoError(t, db.Create(&model.UserVerification{UserId: 2, Status: constant.UserVerificationStatusPending, UpdatedAt: 100}).Error)

	payload := callVerificationHandler(t, 99, AdminListUserVerifications, "/api/user/verifications?status=pending")
	require.Equal(t, true, payload["success"], payload["message"])
	items := payload["data"].(map[string]any)["items"].([]any)
	require.Len(t, items, 2)

	first := items[0].(map[string]any)
	second := items[1].(map[string]any)
	assert.Equal(t, float64(2), first["user_id"], "the submission waiting longest comes first")
	assert.Equal(t, true, first["seller_group"])
	assert.Equal(t, float64(1), second["user_id"])
	assert.Equal(t, false, second["seller_group"])
}

func TestRevokingAVerificationNeedsAReasonAndAnApprovedRecord(t *testing.T) {
	db := setupBuyerVerificationTest(t)
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "verified", AffCode: "aff-verified", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&model.UserVerification{UserId: 1, Status: constant.UserVerificationStatusVerified, VerifiedAt: 100}).Error)
	revoke := func(userId int, body string) map[string]any {
		gin.SetMode(gin.TestMode)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", 99)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/user/verifications/1/revoke", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(userId)}}
		AdminRevokeUserVerification(c)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
		return payload
	}

	assert.Equal(t, false, revoke(1, `{"review_note": ""}`)["success"], "a revoke without a reason is refused")
	require.Equal(t, true, revoke(1, `{"review_note": "document was forged"}`)["success"])

	var stored model.UserVerification
	require.NoError(t, db.Where("user_id = ?", 1).First(&stored).Error)
	assert.Equal(t, constant.UserVerificationStatusRejected, stored.Status)
	assert.Equal(t, "document was forged", stored.ReviewNote, "the user sees why and can submit again")
	assert.Zero(t, stored.VerifiedAt)

	assert.Equal(t, false, revoke(1, `{"review_note": "again"}`)["success"], "only an approved verification can be revoked")
}
