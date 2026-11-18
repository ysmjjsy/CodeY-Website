package controller

import (
	"context"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

// RegisterScheduledSystemTasks wires the periodic channel test, balance update,
// upstream model update, async task polling (Midjourney / Suno / video) and
// task history cleanup jobs into the system task framework so a DB lease
// dedups execution across multiple master instances and each run is recorded
// as one task row. Call this before service.StartSystemTaskRunner.
func RegisterScheduledSystemTasks() {
	service.RegisterSystemTaskHandler(channelTestHandler{})
	service.RegisterSystemTaskHandler(channelBalanceHandler{})
	service.RegisterSystemTaskHandler(modelUpdateHandler{})
	service.RegisterSystemTaskHandler(midjourneyPollHandler{})
	service.RegisterSystemTaskHandler(asyncTaskPollHandler{})
	service.RegisterSystemTaskHandler(systemTaskCleanupHandler{})
	service.RegisterSystemTaskHandler(tokenPackageSellerRecheckHandler{})
	service.RegisterSystemTaskHandler(tokenPackageSettlementHandler{})
	service.RegisterSystemTaskHandler(tokenPackageVersionCheckHandler{})
	service.RegisterSystemTaskHandler(tokenPackageTerminationHandler{})
}

// tokenPackageSellerRecheckHandler stops listings whose seller lost eligibility
// (real-name revocation, group change, publish ban) between explicit writes.
type tokenPackageSellerRecheckHandler struct{}

func (tokenPackageSellerRecheckHandler) Type() string {
	return model.SystemTaskTypeTokenPackageSellerRecheck
}

func (tokenPackageSellerRecheckHandler) Enabled() bool {
	return token_package_setting.IsEnabled()
}

func (tokenPackageSellerRecheckHandler) Interval() time.Duration { return 10 * time.Minute }

func (tokenPackageSellerRecheckHandler) NewPayload() any { return nil }

func (tokenPackageSellerRecheckHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	sellerIDs, err := model.ListActivePackageSellerIDs()
	summary := map[string]int64{"checked": 0, "stopped": 0}
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
		return
	}
	for _, sellerID := range sellerIDs {
		if ctx.Err() != nil {
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, ctx.Err())
			return
		}
		summary["checked"]++
		stopped, err := service.StopIneligibleSellerPackages(sellerID)
		if err != nil {
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
			return
		}
		summary["stopped"] += stopped
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// tokenPackageSettlementHandler releases earned seller shares, pays frozen
// entries and expires finished entitlements once an hour.
type tokenPackageSettlementHandler struct{}

func (tokenPackageSettlementHandler) Type() string {
	return model.SystemTaskTypeTokenPackageSettlement
}

// Enabled stays on with the marketplace switched off: sold entitlements keep
// serving, so their seller shares must still be released, paid and expired.
func (tokenPackageSettlementHandler) Enabled() bool { return true }

func (tokenPackageSettlementHandler) Interval() time.Duration { return time.Hour }

func (tokenPackageSettlementHandler) NewPayload() any { return nil }

func (tokenPackageSettlementHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := map[string]int64{"released": 0, "released_quota": 0, "settled": 0, "settled_quota": 0, "expired": 0}
	result, err := service.RunSellerSettlement(common.GetTimestamp())
	summary["released"] = int64(result.ReleasedCount)
	summary["released_quota"] = result.ReleasedQuota
	summary["settled"] = int64(result.SettledCount)
	summary["settled_quota"] = result.SettledQuota
	summary["expired"] = int64(result.ExpiredCount)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// tokenPackageTerminationHandler refunds the buyers of terminated packages.
// Every run sweeps all terminated packages that still have open entitlements,
// and the scheduler starts a run whenever such a package exists. A run cut
// short by a crash, an expired lease or a failed refund is therefore repeated
// without anyone queueing it again, and one active task covers every package.
type tokenPackageTerminationHandler struct{}

func (tokenPackageTerminationHandler) Type() string {
	return model.SystemTaskTypeTokenPackageTermination
}

// Enabled folds "is any refund still owed?" into enablement, so the scheduler
// only creates a run when there is work.
func (tokenPackageTerminationHandler) Enabled() bool {
	pending, err := service.HasPendingTokenPackageTerminations()
	if err != nil {
		common.SysError(common.LogText("failed to check pending token package terminations: %s", err.Error()))
		return false
	}
	return pending
}

func (tokenPackageTerminationHandler) Interval() time.Duration { return time.Minute }

func (tokenPackageTerminationHandler) NewPayload() any { return nil }

func (tokenPackageTerminationHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	result, err := service.RunPendingTokenPackageTerminations(ctx)
	summary := map[string]int64{"refunded": int64(result.Refunded), "failed": int64(result.Failed)}
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
		return
	}
	if !result.Done {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, errors.New("token package termination left entitlements unrefunded"))
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// tokenPackageVersionCheckHandler runs the connection check of submitted
// package versions in the background. The scheduler starts a run whenever a
// version is waiting in testing, so one interrupted by a restart is checked
// again; submitting a version also queues a run right away.
type tokenPackageVersionCheckHandler struct{}

func (tokenPackageVersionCheckHandler) Type() string {
	return model.SystemTaskTypeTokenPackageVersionCheck
}

func (tokenPackageVersionCheckHandler) Enabled() bool {
	ids, err := model.ListTestingTokenPackageVersionIds()
	if err != nil {
		common.SysError(common.LogText("failed to check token package versions waiting for their check: %s", err.Error()))
		return false
	}
	return len(ids) > 0
}

func (tokenPackageVersionCheckHandler) Interval() time.Duration { return time.Minute }

func (tokenPackageVersionCheckHandler) NewPayload() any { return nil }

func (tokenPackageVersionCheckHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	checked, failed := RunTokenPackageVersionChecks(ctx)
	summary := map[string]int64{"checked": int64(checked), "failed": int64(failed)}
	if failed > 0 {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, errors.New("some token package versions could not be checked"))
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// systemTaskCleanupHandler deletes, once a day, the finished system tasks
// older than the configured retention.
type systemTaskCleanupHandler struct{}

func (systemTaskCleanupHandler) Type() string { return model.SystemTaskTypeCleanup }

func (systemTaskCleanupHandler) Enabled() bool { return true }

func (systemTaskCleanupHandler) Interval() time.Duration { return 24 * time.Hour }

func (systemTaskCleanupHandler) NewPayload() any { return nil }

func (systemTaskCleanupHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	days := max(operation_setting.GetSystemTaskSetting().RetentionDays, 1)
	deleted, err := model.DeleteFinishedSystemTasks(ctx, common.GetTimestamp()-int64(days)*24*60*60)
	status := model.SystemTaskStatusSucceeded
	if err != nil {
		status = model.SystemTaskStatusFailed
	}
	finishSystemTaskHandler(task, runnerID, status, map[string]int64{"deleted_count": deleted}, err)
}

// channelTestHandler runs the scheduled "test all channels" job. Enablement and
// cadence still come from the monitor settings; only the execution path moved
// into the system task runner.
type channelTestHandler struct{}

func (channelTestHandler) Type() string { return model.SystemTaskTypeChannelTest }

func (channelTestHandler) Enabled() bool {
	return operation_setting.GetMonitorSetting().AutoTestChannelEnabled
}

func (channelTestHandler) Interval() time.Duration {
	minutes := operation_setting.GetMonitorSetting().AutoTestChannelMinutes
	if minutes <= 0 {
		minutes = 10
	}
	return time.Duration(minutes * float64(time.Minute))
}

func (channelTestHandler) NewPayload() any { return nil }

// channelTestTaskPayload controls one channel_test run. A nil/empty payload is a
// scheduled run, which uses the configured monitor ChannelTestMode and does not
// notify. A manual "test all channels" trigger sets Mode=scheduled_all and
// Notify=true to reproduce the legacy manual behavior (test every channel and
// notify root on completion).
type channelTestTaskPayload struct {
	Mode   string `json:"mode,omitempty"`
	Notify bool   `json:"notify,omitempty"`
}

func (channelTestHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := channelTestTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary, err := runChannelTestTask(ctx, payload.Mode, payload.Notify, service.NewSystemTaskProgressReporter(task, runnerID))
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// channelBalanceHandler runs an update of all balances, queued by an
// administrator or every CHANNEL_UPDATE_FREQUENCY minutes when that is set.
// Its progress is the task's state, so every node can show it.
type channelBalanceHandler struct{}

func (channelBalanceHandler) Type() string { return model.SystemTaskTypeChannelBalance }

func (channelBalanceHandler) Enabled() bool {
	return common.GetEnvOrDefault("CHANNEL_UPDATE_FREQUENCY", 0) > 0
}

func (channelBalanceHandler) Interval() time.Duration {
	return time.Duration(common.GetEnvOrDefault("CHANNEL_UPDATE_FREQUENCY", 0)) * time.Minute
}

func (channelBalanceHandler) NewPayload() any { return nil }

func (channelBalanceHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary, err := updateAllChannelsBalance(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, summary, err)
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// modelUpdateHandler runs the scheduled upstream model update detection job.
type modelUpdateHandler struct{}

func (modelUpdateHandler) Type() string { return model.SystemTaskTypeModelUpdate }

func (modelUpdateHandler) Enabled() bool {
	return common.GetEnvOrDefaultBool("CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_ENABLED", true)
}

func (modelUpdateHandler) Interval() time.Duration {
	intervalMinutes := common.GetEnvOrDefault(
		"CHANNEL_UPSTREAM_MODEL_UPDATE_TASK_INTERVAL_MINUTES",
		channelUpstreamModelUpdateTaskDefaultIntervalMinutes,
	)
	if intervalMinutes < 1 {
		intervalMinutes = channelUpstreamModelUpdateTaskDefaultIntervalMinutes
	}
	return time.Duration(intervalMinutes) * time.Minute
}

func (modelUpdateHandler) NewPayload() any { return nil }

// modelUpdateTaskPayload controls one model_update run. A scheduled run
// (Manual=false) respects the per-channel minimum check interval and may
// auto-apply detected models when a channel has auto-sync enabled. A manual
// "detect all" trigger sets Manual=true to reproduce the legacy detect-all
// semantics: force a re-check regardless of the interval and never auto-apply,
// so the admin reviews and applies changes explicitly.
type modelUpdateTaskPayload struct {
	Manual bool `json:"manual,omitempty"`
}

func (modelUpdateHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	payload := modelUpdateTaskPayload{}
	if err := task.DecodePayload(&payload); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	summary := runChannelUpstreamModelUpdateTaskOnce(ctx, payload.Manual, !payload.Manual, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// midjourneyPollHandler runs one Midjourney polling pass per scheduled run.
// Enabled() folds the "are there unfinished tasks?" check into enablement so the
// scheduler creates no row when the system is idle; only when at least one
// Midjourney task is in progress does a row get scheduled.
type midjourneyPollHandler struct{}

func (midjourneyPollHandler) Type() string { return model.SystemTaskTypeMidjourneyPoll }

func (midjourneyPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedMidjourneyTasks()
}

func (midjourneyPollHandler) Interval() time.Duration { return 15 * time.Second }

func (midjourneyPollHandler) NewPayload() any { return nil }

func (midjourneyPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := runMidjourneyTaskUpdateOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

// asyncTaskPollHandler runs one async-task (Suno/video) polling pass per
// scheduled run. Like midjourneyPollHandler, Enabled() folds in the unfinished
// task existence check so an idle system schedules no rows.
type asyncTaskPollHandler struct{}

func (asyncTaskPollHandler) Type() string { return model.SystemTaskTypeAsyncTaskPoll }

func (asyncTaskPollHandler) Enabled() bool {
	return constant.UpdateTask && model.HasUnfinishedSyncTasks()
}

func (asyncTaskPollHandler) Interval() time.Duration { return 15 * time.Second }

func (asyncTaskPollHandler) NewPayload() any { return nil }

func (asyncTaskPollHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	summary := service.RunTaskPollingOnce(ctx, service.NewSystemTaskProgressReporter(task, runnerID))
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, summary, nil)
}

func finishSystemTaskHandler(task *model.SystemTask, runnerID string, status model.SystemTaskStatus, result any, runErr error) {
	errorMessage := ""
	if runErr != nil {
		errorMessage = runErr.Error()
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, status, result, errorMessage); err != nil {
		common.SysLog(common.LogText("system task %s failed to persist result: %v", task.TaskID, err))
	}
}
