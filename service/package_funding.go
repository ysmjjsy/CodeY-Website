package service

import (
	"errors"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
	"github.com/bytedance/gopkg/util/gopool"
)

// PackageFunding charges one token package entitlement. It never touches wallet
// balance or subscriptions: a package request that runs out of package quota is
// rejected instead of falling back to another funding source (D6).
type PackageFunding struct {
	userId        int
	packageId     int
	entitlementId int
	requestId     string
	preConsumed   int64
}

func (p *PackageFunding) Source() string { return BillingSourcePackage }

func (p *PackageFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	if p.entitlementId <= 0 {
		entitlement, err := model.GetServablePackageEntitlement(p.userId, p.packageId)
		if err != nil {
			if errors.Is(err, model.ErrTokenPackageEntitlementMissing) {
				return ErrPackageQuotaExhausted
			}
			return err
		}
		p.entitlementId = entitlement.Id
	}
	// A request can reserve more than once: an image batch raises its estimate
	// before it is sent. The first reservation creates the request's record;
	// later ones grow that same record, so settlement and refund still see the
	// whole amount under one request id.
	var err error
	if p.preConsumed > 0 {
		err = model.AdjustPackageReservation(p.requestId, int64(amount))
	} else {
		err = model.PreConsumePackageEntitlement(p.entitlementId, p.requestId, int64(amount))
	}
	if err != nil {
		if errors.Is(err, model.ErrTokenPackageEntitlementMissing) {
			return ErrPackageQuotaExhausted
		}
		return err
	}
	p.preConsumed += int64(amount)
	return nil
}

// releaseReservation undoes part of a reservation when the token side of the
// same reservation could not be taken.
func (p *PackageFunding) releaseReservation(amount int) error {
	if amount <= 0 || p.preConsumed <= 0 {
		return nil
	}
	if err := model.AdjustPackageReservation(p.requestId, -int64(amount)); err != nil {
		return err
	}
	p.preConsumed = max(p.preConsumed-int64(amount), 0)
	return nil
}

func (p *PackageFunding) Settle(delta int) error {
	if p.requestId == "" || delta == 0 {
		return nil
	}
	err := model.SettlePackagePreconsume(p.requestId, int64(delta))
	if errors.Is(err, model.ErrTokenPackagePreconsumeMissing) {
		if p.preConsumed == 0 && delta <= 0 {
			return nil
		}
		return err
	}
	return err
}

func (p *PackageFunding) Refund() error {
	if p.requestId == "" {
		return nil
	}
	err := model.RefundPackagePreconsume(p.requestId)
	if errors.Is(err, model.ErrTokenPackagePreconsumeMissing) {
		return nil
	}
	return err
}

// packageLowBalanceNotifiedAt rate-limits low-balance notices per entitlement so
// a burst of small requests cannot spam the buyer.
var packageLowBalanceNotifiedAt sync.Map

const packageLowBalanceNotifyInterval int64 = 24 * 3600

// checkAndSendPackageQuotaNotify tells the buyer when a package entitlement
// drops under the configured low-balance ratio. The check runs after settlement
// so the remaining amount includes the request that just finished.
func checkAndSendPackageQuotaNotify(relayInfo *relaycommon.RelayInfo) {
	if relayInfo == nil || relayInfo.PackageEntitlementId <= 0 {
		return
	}
	gopool.Go(func() {
		entitlement, err := model.GetTokenPackageEntitlement(relayInfo.PackageEntitlementId)
		if err != nil || entitlement.AmountTotal <= 0 {
			return
		}
		ratio := token_package_setting.GetTokenPackageSetting().LowBalanceRatio
		if ratio <= 0 {
			return
		}
		remaining := entitlement.AmountRemaining()
		if float64(remaining) > float64(entitlement.AmountTotal)*ratio {
			return
		}
		now := common.GetTimestamp()
		if last, ok := packageLowBalanceNotifiedAt.Load(entitlement.Id); ok {
			if lastAt, ok := last.(int64); ok && now-lastAt < packageLowBalanceNotifyInterval {
				return
			}
		}
		packageLowBalanceNotifiedAt.Store(entitlement.Id, now)

		user, err := model.GetUserById(entitlement.UserId, false)
		if err != nil {
			return
		}
		userSetting := user.GetSetting()
		lang := userSetting.Language
		prompt := i18n.Translate(lang, i18n.MsgNotifyPackageQuotaLowTitle)
		content, values := quotaNotifyContent(lang, userSetting.NotifyType, prompt, logger.FormatQuota(int(remaining)))
		if err := NotifyUser(entitlement.UserId, user.Email, userSetting, dto.NewNotify(dto.NotifyTypeQuotaExceed, prompt, content, values)); err != nil {
			common.SysError(common.LogText("failed to send package quota notify to user %d: %s", entitlement.UserId, err.Error()))
		}
	})
}
