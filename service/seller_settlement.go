package service

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/token_package_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// SellerSettlementSummary reports what one settlement run changed.
type SellerSettlementSummary struct {
	ReleasedCount int
	ReleasedQuota int64
	SettledCount  int
	SettledQuota  int64
	ExpiredCount  int
}

// RunSellerSettlement releases consumed seller shares into the freeze queue,
// pays frozen entries whose window has passed, and expires finished
// entitlements. Every step recomputes from database state, so running the task
// again never pays twice.
func RunSellerSettlement(now int64) (SellerSettlementSummary, error) {
	var summary SellerSettlementSummary
	settings := token_package_setting.GetTokenPackageSetting()
	freezeDays := settings.FreezeDays

	entitlements, err := model.ListSettleableTokenPackageEntitlements()
	if err != nil {
		return summary, err
	}
	for i := range entitlements {
		entitlement := entitlements[i]
		if entitlement.EndTime <= now {
			released, releaseErr := model.ExpirePackageEntitlement(entitlement.Id, now, freezeDays)
			if releaseErr != nil {
				return summary, releaseErr
			}
			summary.ExpiredCount++
			if released > 0 {
				summary.ReleasedCount++
				summary.ReleasedQuota += released
			}
			continue
		}
		released, releaseErr := model.ReleaseEntitlementShare(entitlement.Id, now, freezeDays)
		if releaseErr != nil {
			return summary, releaseErr
		}
		if released > 0 {
			summary.ReleasedCount++
			summary.ReleasedQuota += released
		}
	}

	settledCount, settledQuota, err := model.SettleFrozenSellerEntries(now)
	if err != nil {
		return summary, err
	}
	summary.SettledCount = settledCount
	summary.SettledQuota = settledQuota
	return summary, nil
}

// terminationWait bounds how long a termination waits for in-flight requests
// before settling them at the already reserved amount.
const terminationWait = 10 * time.Minute

// TerminationResult reports one pass over a terminated package. Done is true
// only when every entitlement has been closed, which is what makes a retry stop.
type TerminationResult struct {
	Refunded int
	Failed   int
	Done     bool
}

// TerminateTokenPackage stops a package for good and refunds every entitlement
// that still holds quota. Completion is decided by the entitlements, not by the
// package status: a run that stops halfway leaves the package terminated and the
// remaining entitlements open, and the next run finishes them.
func TerminateTokenPackage(ctx context.Context, packageId int) (TerminationResult, error) {
	var result TerminationResult
	pkg, err := MarkTokenPackageTerminated(packageId)
	if err != nil {
		return result, err
	}

	now := common.GetTimestamp()
	settings := token_package_setting.GetTokenPackageSetting()
	entitlements, err := model.ListSettleableTokenPackageEntitlementsByPackage(packageId)
	if err != nil {
		return result, err
	}
	for i := range entitlements {
		entitlement := entitlements[i]
		// A cancelled caller cannot wait: the in-flight requests are closed
		// at their reserved amount so the refund still accounts for them.
		if ctx.Err() != nil {
			requestIds, listErr := model.PendingPreconsumeRequestIDs(entitlement.Id)
			if listErr == nil {
				closePendingPreconsume(requestIds)
			}
		} else {
			waitCtx, cancelWait := context.WithTimeout(ctx, terminationWait)
			waitForPendingPreconsume(waitCtx, entitlement.Id)
			cancelWait()
		}
		if _, err := model.ReleaseEntitlementShare(entitlement.Id, now, settings.FreezeDays); err != nil {
			result.Failed++
			common.SysError(common.LogText("failed to release entitlement %d of package %d: %s", entitlement.Id, packageId, err.Error()))
			continue
		}
		refunded, err := model.RefundTerminatedEntitlement(entitlement.Id, now)
		if err != nil {
			result.Failed++
			common.SysError(common.LogText("failed to refund entitlement %d of package %d: %s", entitlement.Id, packageId, err.Error()))
			continue
		}
		result.Refunded++
		InvalidatePackageEntitlementCache(entitlement.UserId, entitlement.PackageId)
		if refunded > 0 {
			notifyPackageTerminated(entitlement.UserId, pkg.Title, refunded)
		}
	}
	result.Done = result.Failed == 0
	return result, nil
}

// MarkTokenPackageTerminated stops a package from serving and selling at once.
// The refunds run afterwards in the background; marking first means no new
// request can start on the package while they are computed.
func MarkTokenPackageTerminated(packageId int) (*model.TokenPackage, error) {
	if packageId <= 0 {
		return nil, model.ErrTokenPackageNotFound
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		return nil, err
	}
	if pkg.Status != constant.TokenPackageStatusTerminated {
		if _, err := model.SetTokenPackageStatus(packageId,
			[]string{constant.TokenPackageStatusDraft, constant.TokenPackageStatusListed,
				constant.TokenPackageStatusPaused, constant.TokenPackageStatusStopped},
			constant.TokenPackageStatusTerminated); err != nil {
			return nil, err
		}
		pkg.Status = constant.TokenPackageStatusTerminated
	}
	model.PurgePackageRouting(packageId)
	// Other nodes drop the package from their routing index on their next
	// channel reload; token auth already refuses a terminated package.
	model.BumpSyncTopic(model.SyncTopicChannels)
	InvalidatePackagePricingCache(packageId)
	return pkg, nil
}

// HasPendingTokenPackageTerminations reports whether a terminated package still
// has entitlements to refund.
func HasPendingTokenPackageTerminations() (bool, error) {
	ids, err := model.ListTerminatedPackageIdsWithOpenEntitlements()
	return len(ids) > 0, err
}

// RunPendingTokenPackageTerminations refunds every terminated package that
// still has open entitlements. The termination task runs this whole sweep, so
// one queued task covers every package, and a sweep cut short by a crash or a
// failed refund is simply repeated by the next one.
func RunPendingTokenPackageTerminations(ctx context.Context) (TerminationResult, error) {
	total := TerminationResult{Done: true}
	packageIds, err := model.ListTerminatedPackageIdsWithOpenEntitlements()
	if err != nil {
		total.Done = false
		return total, err
	}
	for _, packageId := range packageIds {
		result, err := TerminateTokenPackage(ctx, packageId)
		total.Refunded += result.Refunded
		total.Failed += result.Failed
		if err != nil {
			common.SysError(common.LogText("failed to terminate token package %d: %s", packageId, err.Error()))
			total.Done = false
			continue
		}
		if !result.Done {
			total.Done = false
		}
	}
	return total, nil
}

// waitForPendingPreconsume lets in-flight requests settle on their own, then
// closes whatever is left at the reserved amount so the refund cannot miss
// usage that was already started.
func waitForPendingPreconsume(ctx context.Context, entitlementId int) {
	deadline := time.Now().Add(terminationWait)
	for {
		requestIds, err := model.PendingPreconsumeRequestIDs(entitlementId)
		if err != nil || len(requestIds) == 0 {
			return
		}
		if time.Now().After(deadline) {
			closePendingPreconsume(requestIds)
			return
		}
		select {
		case <-ctx.Done():
			closePendingPreconsume(requestIds)
			return
		case <-time.After(time.Second):
		}
	}
}

func closePendingPreconsume(requestIds []string) {
	for _, requestId := range requestIds {
		if err := model.SettlePendingPreconsume(requestId); err != nil {
			common.SysLog(common.LogText("failed to close pending package preconsume %s: %s", requestId, err.Error()))
		}
	}
}

func notifyPackageTerminated(userId int, packageTitle string, refunded int64) {
	gopool.Go(func() {
		user, err := model.GetUserById(userId, false)
		if err != nil {
			return
		}
		userSetting := user.GetSetting()
		lang := userSetting.Language
		prompt := i18n.Translate(lang, i18n.MsgNotifyPackageTerminatedTitle)
		content := i18n.Translate(lang, i18n.MsgNotifyPackageTerminatedContent, map[string]any{
			"Package": packageTitle,
			"Quota":   logger.FormatQuota(int(refunded)),
		})
		values := []any{packageTitle, logger.FormatQuota(int(refunded))}
		if err := NotifyUser(userId, user.Email, userSetting, dto.NewNotify(dto.NotifyTypeTokenPackage, prompt, content, values)); err != nil {
			common.SysError(common.LogText("failed to send package termination notify to user %d: %s", userId, err.Error()))
		}
	})
}
