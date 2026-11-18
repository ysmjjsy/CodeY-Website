package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/realname"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
	"github.com/gin-gonic/gin"
)

// GetUserVerification returns the caller's real-name state. An absent record is
// the unverified state rather than an error.
func GetUserVerification(c *gin.Context) {
	userId := c.GetInt("id")
	verification, err := model.GetUserVerificationByUserId(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if verification == nil {
		common.ApiSuccess(c, dto.VerificationStatusResponse{Status: constant.UserVerificationStatusUnverified})
		return
	}
	response := dto.VerificationStatusResponse{
		Status:          verification.Status,
		Provider:        verification.Provider,
		ProviderTraceID: verification.ProviderTraceId,
		MaskedName:      verification.MaskedName,
		VerifiedAt:      verification.VerifiedAt,
		UpdatedAt:       verification.UpdatedAt,
	}
	// The reviewer's reason is what a rejected user needs to correct the
	// submission; other states carry no note worth showing.
	if verification.Status == constant.UserVerificationStatusRejected {
		response.ReviewNote = verification.ReviewNote
	}
	common.ApiSuccess(c, response)
}

// SubmitUserVerification accepts a real-name submission for manual review. The
// plaintext ID number exists only in memory; storage keeps a masked name and an
// HMAC digest, which is enough for wash-trading checks.
func SubmitUserVerification(c *gin.Context) {
	if !realname.IsHashSecretConfigured() {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Real-name verification is not available."), gin.H{"code": "REALNAME_UNAVAILABLE"})
		return
	}
	var req dto.SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeRealnameSubmit}) == nil {
		return
	}
	userId := c.GetInt("id")
	existing, err := model.GetUserVerificationByUserId(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if existing != nil && existing.Status == constant.UserVerificationStatusVerified {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Real-name verification is already completed."), gin.H{"code": "REALNAME_ALREADY_VERIFIED"})
		return
	}
	submission, err := realname.PrepareSubmission(realname.VerifyRequest{
		UserID:         userId,
		RealName:       req.RealName,
		IDNumber:       req.IDNumber,
		Consent:        req.Consent,
		ConsentVersion: req.ConsentVersion,
	})
	if err != nil {
		writeRealnameError(c, err)
		return
	}
	now := common.GetTimestamp()
	record := &model.UserVerification{
		UserId:         userId,
		Status:         constant.UserVerificationStatusPending,
		Provider:       realname.ProviderManual,
		MaskedName:     submission.MaskedName,
		IdNumberHash:   submission.IDNumberHash,
		ConsentAt:      now,
		ConsentVersion: realname.CurrentConsentVersion,
	}
	if err := model.UpsertUserVerification(record); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, dto.VerificationStatusResponse{
		Status:     constant.UserVerificationStatusPending,
		Provider:   realname.ProviderManual,
		MaskedName: submission.MaskedName,
		UpdatedAt:  now,
	})
}

func writeRealnameError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, realname.ErrConsentRequired):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Privacy consent is required."), gin.H{"code": "REALNAME_CONSENT_REQUIRED"})
	case errors.Is(err, realname.ErrInvalidRealnameInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Enter a valid real name and ID number."), gin.H{"code": "REALNAME_INPUT_INVALID"})
	case errors.Is(err, realname.ErrInvalidIDNumber):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("The ID number format is invalid."), gin.H{"code": "REALNAME_ID_INVALID"})
	case errors.Is(err, realname.ErrHashSecretNotConfigured):
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Real-name verification is not available."), gin.H{"code": "REALNAME_UNAVAILABLE"})
	default:
		common.ApiError(c, err)
	}
}

// AdminListUserVerifications lists submissions with the ID hash omitted.
func AdminListUserVerifications(c *gin.Context) {
	page := common.GetPageQuery(c)
	rows, total, err := model.ListUserVerifications(c.Query("status"), strings.TrimSpace(c.Query("keyword")), page.GetPage(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
	}
	usernames, err := model.GetUsernamesByIds(userIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groups, err := model.GetUserGroupsByIds(userIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]dto.AdminVerificationResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, dto.AdminVerificationResponse{
			UserID:          row.UserId,
			Username:        usernames[row.UserId],
			Status:          row.Status,
			Provider:        row.Provider,
			ProviderTraceID: row.ProviderTraceId,
			MaskedName:      row.MaskedName,
			ReviewNote:      row.ReviewNote,
			ReviewedBy:      row.ReviewedBy,
			ConsentAt:       row.ConsentAt,
			ConsentVersion:  row.ConsentVersion,
			VerifiedAt:      row.VerifiedAt,
			CreatedAt:       row.CreatedAt,
			UpdatedAt:       row.UpdatedAt,
			SellerGroup:     token_package_setting.IsSellerGroupAllowed(groups[row.UserId]),
		})
	}
	page.SetTotal(int(total))
	page.SetItems(items)
	// Viewing real-name records is itself audited (design §11.3). The search
	// keyword can be part of a name, so only whether one was used is kept.
	recordManageAudit(c, "seller.verification_view", map[string]any{
		"status":      strings.TrimSpace(c.Query("status")),
		"count":       len(items),
		"keyword_set": strings.TrimSpace(c.Query("keyword")) != "",
	})
	common.ApiSuccess(c, page)
}

// AdminReviewUserVerification approves or rejects one pending submission.
func AdminReviewUserVerification(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user ID")
		return
	}
	var req dto.ReviewVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	reviewerId := c.GetInt("id")
	if err := model.ReviewUserVerification(userId, reviewerId, req.Approved, req.ReviewNote); err != nil {
		if errors.Is(err, model.ErrVerificationNotPending) {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("This submission is no longer pending review."), gin.H{"code": "REALNAME_NOT_PENDING"})
			return
		}
		common.ApiError(c, err)
		return
	}
	if !req.Approved {
		if _, stopErr := service.StopIneligibleSellerPackages(userId); stopErr != nil {
			common.SysLog(common.LogText("failed to stop packages of rejected seller %d: %s", userId, stopErr.Error()))
		}
	}
	recordManageAudit(c, "seller.verification_review", map[string]any{"target_user_id": userId, "approved": req.Approved})
	service.NotifyRealnameReviewResult(userId, req.Approved, req.ReviewNote)
	status := constant.UserVerificationStatusRejected
	if req.Approved {
		status = constant.UserVerificationStatusVerified
	}
	common.ApiSuccess(c, gin.H{"user_id": userId, "status": status})
}

// AdminRevokeUserVerification withdraws an approved verification. The user
// stops being able to buy or publish at once, and their listed packages stop
// selling; packages already sold keep serving.
func AdminRevokeUserVerification(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user ID")
		return
	}
	var req dto.ReviewVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	reason := strings.TrimSpace(req.ReviewNote)
	if reason == "" {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("A reason is required to revoke a verification."), gin.H{"code": "REALNAME_REASON_REQUIRED"})
		return
	}
	if err := model.RevokeUserVerification(userId, c.GetInt("id"), reason); err != nil {
		if errors.Is(err, model.ErrVerificationNotVerified) {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("This user has no approved verification."), gin.H{"code": "REALNAME_NOT_VERIFIED"})
			return
		}
		common.ApiError(c, err)
		return
	}
	if _, stopErr := service.StopIneligibleSellerPackages(userId); stopErr != nil {
		common.SysLog(common.LogText("failed to stop packages of revoked seller %d: %s", userId, stopErr.Error()))
	}
	recordManageAudit(c, "seller.verification_revoke", map[string]any{"target_user_id": userId})
	service.NotifyRealnameReviewResult(userId, false, reason)
	common.ApiSuccess(c, gin.H{"user_id": userId, "status": constant.UserVerificationStatusRejected})
}
