package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// GetSellerStatus returns the caller's publishing eligibility for the seller
// center entry point. The reason identifier maps to console copy; it never
// mentions internal group names.
func GetSellerStatus(c *gin.Context) {
	eligibility, err := service.EvaluateSellerEligibility(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	response := dto.SellerStatusResponse{
		Eligible:           eligibility.Eligible,
		Verified:           eligibility.Verified,
		InSellerGroup:      eligibility.InSellerGroup,
		PublishBanned:      eligibility.PublishBanned,
		BanReason:          eligibility.BanReason,
		VerificationStatus: eligibility.VerificationStatus,
	}
	if eligibility.Reason != "" {
		response.Reasons = []string{eligibility.Reason}
	}
	common.ApiSuccess(c, response)
}

// AdminListSellers returns seller profiles with eligibility merged in.
func AdminListSellers(c *gin.Context) {
	page := common.GetPageQuery(c)
	var bannedOnly *bool
	if raw := strings.TrimSpace(c.Query("banned")); raw != "" {
		value := raw == "true" || raw == "1"
		bannedOnly = &value
	}
	profiles, total, err := model.ListSellerProfiles(page.GetPage(), page.GetPageSize(), strings.TrimSpace(c.Query("keyword")), bannedOnly)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userIds := make([]int, 0, len(profiles))
	for _, profile := range profiles {
		userIds = append(userIds, profile.UserId)
	}
	usernames, err := model.GetUsernamesByIds(userIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]dto.SellerProfileResponse, 0, len(profiles))
	for _, profile := range profiles {
		eligibility, err := service.EvaluateSellerEligibility(profile.UserId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		items = append(items, dto.SellerProfileResponse{
			UserID:                profile.UserId,
			Username:              usernames[profile.UserId],
			PublishBanned:         profile.PublishBanned,
			BanReason:             profile.BanReason,
			CommissionBpsOverride: profile.CommissionBpsOverride,
			EffectiveCommission:   eligibility.EffectiveCommissionBps,
			PendingQuota:          profile.PendingQuota,
			FrozenQuota:           profile.FrozenQuota,
			SettledTotalQuota:     profile.SettledTotalQuota,
			Eligible:              eligibility.Eligible,
			VerificationStatus:    eligibility.VerificationStatus,
		})
	}
	page.SetTotal(int(total))
	page.SetItems(items)
	common.ApiSuccess(c, page)
}

// AdminUpdateSeller applies a publish ban or a commission override. A new ban
// stops the seller's active listings immediately; sold entitlements keep
// serving.
func AdminUpdateSeller(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("userId"))
	if err != nil || userId <= 0 {
		common.ApiErrorMsg(c, "Invalid user ID")
		return
	}
	var req dto.AdminUpdateSellerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	profile, err := model.UpdateSellerProfileAdmin(userId, req.PublishBanned, &req.BanReason, req.CommissionBpsOverride, req.ClearCommission)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if profile.PublishBanned {
		if _, err := service.StopIneligibleSellerPackages(userId); err != nil {
			common.SysLog(common.LogText("failed to stop packages of banned seller %d: %s", userId, err.Error()))
		}
	}
	params := map[string]any{"target_user_id": userId, "publish_banned": profile.PublishBanned}
	if profile.CommissionBpsOverride != nil {
		params["commission_bps_override"] = *profile.CommissionBpsOverride
	}
	recordManageAudit(c, "seller.update", params)
	common.ApiSuccess(c, gin.H{"profile": profile})
}

// GetSellerLedger lists the caller's revenue ledger entries.
func GetSellerLedger(c *gin.Context) {
	page := common.GetPageQuery(c)
	entries, total, err := model.ListFrozenSellerLedgerEntries(c.GetInt("id"), page.Page, page.PageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]dto.SellerLedgerEntryResponse, 0, len(entries))
	for i := range entries {
		entry := entries[i]
		items = append(items, dto.SellerLedgerEntryResponse{
			ID:            entry.Id,
			SellerUserID:  entry.SellerUserId,
			EntitlementID: entry.EntitlementId,
			OrderID:       entry.OrderId,
			Type:          entry.Type,
			Amount:        entry.Amount,
			AvailableAt:   entry.AvailableAt,
			Status:        entry.Status,
			CreatedAt:     entry.CreatedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page.Page, "page_size": page.PageSize})
}

// GetSellerStats returns the revenue header for the seller center.
func GetSellerStats(c *gin.Context) {
	summary, err := model.GetSellerRevenueSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}
