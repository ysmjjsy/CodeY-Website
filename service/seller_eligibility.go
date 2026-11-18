package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/token_package_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// Seller ineligibility reasons are stable identifiers shared with the console.
const (
	SellerReasonNeedVerification = "need_verification"
	SellerReasonNotAuthorized    = "not_authorized"
	SellerReasonBanned           = "banned"
)

// SellerEligibility is the server-side answer to "may this user publish right
// now". It is recomputed on every write; the console only displays it.
type SellerEligibility struct {
	Eligible               bool
	Verified               bool
	InSellerGroup          bool
	PublishBanned          bool
	BanReason              string
	VerificationStatus     string
	Reason                 string
	EffectiveCommissionBps int
}

// EvaluateSellerEligibility derives the publishing status from real-name
// verification, the configured seller groups and the seller profile. Platform
// administrators bypass the verification and group gates so operators can
// create managed packages; a publish ban applies to everyone.
func EvaluateSellerEligibility(userId int) (*SellerEligibility, error) {
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	verification, err := model.GetUserVerificationByUserId(userId)
	if err != nil {
		return nil, err
	}
	profile, err := model.GetSellerProfileByUserId(userId)
	if err != nil {
		return nil, err
	}

	eligibility := &SellerEligibility{
		VerificationStatus:     constant.UserVerificationStatusUnverified,
		EffectiveCommissionBps: token_package_setting.GetTokenPackageSetting().CommissionBps,
	}
	if verification != nil {
		eligibility.VerificationStatus = verification.Status
		eligibility.Verified = verification.Status == constant.UserVerificationStatusVerified
	}
	eligibility.InSellerGroup = token_package_setting.IsSellerGroupAllowed(user.Group)
	if profile != nil {
		eligibility.PublishBanned = profile.PublishBanned
		eligibility.BanReason = profile.BanReason
		if profile.CommissionBpsOverride != nil && *profile.CommissionBpsOverride >= 0 && *profile.CommissionBpsOverride <= 10000 {
			eligibility.EffectiveCommissionBps = *profile.CommissionBpsOverride
		}
	}

	isAdmin := user.Role >= common.RoleAdminUser
	switch {
	case eligibility.PublishBanned:
		eligibility.Reason = SellerReasonBanned
	case !isAdmin && !eligibility.Verified:
		eligibility.Reason = SellerReasonNeedVerification
	case !isAdmin && !eligibility.InSellerGroup:
		eligibility.Reason = SellerReasonNotAuthorized
	default:
		eligibility.Eligible = true
	}
	return eligibility, nil
}

// IsSellerEligible reports the boolean verdict plus the reason identifier.
func IsSellerEligible(userId int) (bool, string, error) {
	eligibility, err := EvaluateSellerEligibility(userId)
	if err != nil {
		return false, "", err
	}
	return eligibility.Eligible, eligibility.Reason, nil
}

// StopIneligibleSellerPackages stops every active listing owned by a seller who
// is no longer eligible. Sold entitlements keep serving until expiry by design.
func StopIneligibleSellerPackages(userId int) (int64, error) {
	eligibility, err := EvaluateSellerEligibility(userId)
	if err != nil {
		return 0, err
	}
	if eligibility.Eligible {
		return 0, nil
	}
	return model.StopActivePackagesBySeller(userId)
}

// NotifyRealnameReviewResult tells the user how an administrator decided their
// real-name submission. Buyers cannot purchase until they are verified, so the
// notice is what brings them back once the review is done.
func NotifyRealnameReviewResult(userId int, approved bool, reviewNote string) {
	gopool.Go(func() {
		user, err := model.GetUserById(userId, false)
		if err != nil {
			return
		}
		userSetting := user.GetSetting()
		lang := userSetting.Language
		titleKey := i18n.MsgNotifyRealnameRejectedTitle
		contentKey := i18n.MsgNotifyRealnameRejectedContent
		if approved {
			titleKey = i18n.MsgNotifyRealnameApprovedTitle
			contentKey = i18n.MsgNotifyRealnameApprovedContent
		}
		reason := strings.TrimSpace(reviewNote)
		title := i18n.Translate(lang, titleKey)
		content := i18n.Translate(lang, contentKey, map[string]any{"Reason": reason})
		if err := NotifyUser(userId, user.Email, userSetting, dto.NewNotify(dto.NotifyTypeTokenPackage, title, content, []any{reason})); err != nil {
			common.SysError(common.LogText("failed to send real-name review notify to user %d: %s", userId, err.Error()))
		}
	})
}
