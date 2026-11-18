package controller

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

const tokenPackageTitleMaxLength = 128

func buildTokenPackageVersionResponse(version *model.TokenPackageVersion, bindings []*model.TokenPackageChannel) *dto.TokenPackageVersionResponse {
	response := &dto.TokenPackageVersionResponse{
		ID:          version.Id,
		PackageID:   version.PackageId,
		VersionNo:   version.VersionNo,
		Status:      version.Status,
		Models:      version.GetModelSpecs(),
		SKUs:        version.GetSKUList(),
		TestReport:  version.GetTestReport(),
		SubmittedAt: version.SubmittedAt,
		ReviewedBy:  version.ReviewedBy,
		ReviewedAt:  version.ReviewedAt,
		ReviewNote:  version.ReviewNote,
		CreatedAt:   version.CreatedAt,
	}
	if bindings != nil {
		channelBindings := make([]dto.TokenPackageChannelBinding, 0, len(bindings))
		for _, binding := range bindings {
			channelBindings = append(channelBindings, dto.TokenPackageChannelBinding{
				ChannelID: binding.ChannelId,
				Models:    binding.GetModels(),
				Priority:  binding.Priority,
				Weight:    binding.Weight,
			})
		}
		response.Channels = channelBindings
	}
	return response
}

func buildTokenPackageResponse(pkg *model.TokenPackage, activeVersion, latestVersion *model.TokenPackageVersion) dto.TokenPackageResponse {
	response := dto.TokenPackageResponse{
		ID:              pkg.Id,
		SellerUserID:    pkg.SellerUserId,
		BillingMode:     pkg.BillingMode,
		Title:           pkg.Title,
		Subtitle:        pkg.Subtitle,
		Description:     pkg.Description,
		Status:          pkg.Status,
		ActiveVersionID: pkg.ActiveVersionId,
		Degraded:        pkg.Degraded,
		CreatedAt:       pkg.CreatedAt,
		UpdatedAt:       pkg.UpdatedAt,
	}
	if activeVersion != nil {
		bindings, _ := model.GetVersionChannels(activeVersion.Id)
		response.ActiveVersion = buildTokenPackageVersionResponse(activeVersion, bindings)
	}
	if latestVersion != nil && (activeVersion == nil || latestVersion.Id != activeVersion.Id) {
		bindings, _ := model.GetVersionChannels(latestVersion.Id)
		response.LatestVersion = buildTokenPackageVersionResponse(latestVersion, bindings)
	}
	return response
}

// runTokenPackageAutoCheck probes every bound channel and model pair. A
// failure blocks submission; a returned model that differs from the requested
// one is recorded for the reviewer instead of failing the check.
func runTokenPackageAutoCheck(ctx context.Context, sellerUserId int, bindings []*model.TokenPackageChannel) *dto.TokenPackageTestReport {
	report := &dto.TokenPackageTestReport{CheckedAt: common.GetTimestamp(), Passed: true}
	for _, binding := range bindings {
		channel, err := model.GetChannelById(binding.ChannelId, true)
		if err != nil {
			report.Passed = false
			report.Results = append(report.Results, dto.TokenPackageChannelTestItem{
				ChannelID: binding.ChannelId,
				Model:     "",
				Error:     "channel is no longer available",
			})
			report.FailReasons = append(report.FailReasons, "channel "+strconv.Itoa(binding.ChannelId)+" is no longer available")
			continue
		}
		for _, modelName := range binding.GetModels() {
			started := time.Now()
			result := testChannel(ctx, channel, sellerUserId, modelName, "", false)
			elapsed := time.Since(started)
			item := dto.TokenPackageChannelTestItem{
				ChannelID:   channel.Id,
				ChannelName: channel.Name,
				Model:       modelName,
				LatencyMs:   elapsed.Milliseconds(),
			}
			if result.localErr != nil {
				item.Error = result.localErr.Error()
			} else if result.newAPIError != nil {
				item.Error = result.newAPIError.Error()
			} else {
				item.Success = true
				item.ReturnedModel = testResponseModel(result.responseBody)
				if item.ReturnedModel != "" && !strings.EqualFold(item.ReturnedModel, modelName) {
					item.ModelMismatch = true
				}
			}
			if !item.Success {
				report.Passed = false
				report.FailReasons = append(report.FailReasons, channel.Name+" / "+modelName+": "+item.Error)
			}
			report.Results = append(report.Results, item)
		}
	}
	return report
}

// testResponseModel reads the model name echoed by the upstream response.
func testResponseModel(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var payload struct {
		Model string `json:"model"`
	}
	if err := common.Unmarshal(body, &payload); err != nil {
		return ""
	}
	if payload.Model != "" {
		return payload.Model
	}
	var withResponse struct {
		Response struct {
			Model string `json:"model"`
		} `json:"response"`
	}
	if err := common.Unmarshal(body, &withResponse); err != nil {
		return ""
	}
	return withResponse.Response.Model
}

func saveTokenPackageTestReport(versionId int, report *dto.TokenPackageTestReport) error {
	encoded, err := common.Marshal(report)
	if err != nil {
		return err
	}
	return model.DB.Model(&model.TokenPackageVersion{}).Where("id = ?", versionId).
		Update("test_report", string(encoded)).Error
}

func GetSellerPackages(c *gin.Context) {
	userId := c.GetInt("id")
	packages, err := model.ListTokenPackagesBySeller(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	responses := make([]dto.TokenPackageResponse, 0, len(packages))
	for _, pkg := range packages {
		activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
		latestVersion, _ := model.GetLatestTokenPackageVersion(pkg.Id)
		responses = append(responses, buildTokenPackageResponse(pkg, activeVersion, latestVersion))
	}
	common.ApiSuccess(c, responses)
}

func CreateSellerPackage(c *gin.Context) {
	userId := c.GetInt("id")
	request := dto.CreateTokenPackageRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		common.ApiError(c, common.NewMessage("Package title is required"))
		return
	}
	if len(title) > tokenPackageTitleMaxLength {
		common.ApiError(c, common.NewMessage("Package title cannot exceed {{count}} characters", map[string]any{"count": tokenPackageTitleMaxLength}))
		return
	}
	billingMode := strings.TrimSpace(request.BillingMode)
	if billingMode == "" {
		billingMode = constant.TokenPackageBillingModeQuota
	}
	if billingMode != constant.TokenPackageBillingModeQuota {
		common.ApiError(c, common.NewMessage("Only quota packages are available"))
		return
	}
	pkg := &model.TokenPackage{
		SellerUserId: userId,
		BillingMode:  billingMode,
		Title:        title,
		Subtitle:     strings.TrimSpace(request.Subtitle),
		Description:  strings.TrimSpace(request.Description),
		Status:       constant.TokenPackageStatusDraft,
	}
	if len(pkg.Subtitle) > 256 {
		common.ApiError(c, common.NewMessage("Package subtitle cannot exceed {{count}} characters", map[string]any{"count": 256}))
		return
	}
	if err := model.CreateTokenPackage(pkg); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, nil, nil))
}

func UpdateSellerPackage(c *gin.Context) {
	userId := c.GetInt("id")
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request := dto.UpdateTokenPackageRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		common.ApiError(c, common.NewMessage("Package title is required"))
		return
	}
	if len(title) > tokenPackageTitleMaxLength {
		common.ApiError(c, common.NewMessage("Package title cannot exceed {{count}} characters", map[string]any{"count": tokenPackageTitleMaxLength}))
		return
	}
	subtitle := strings.TrimSpace(request.Subtitle)
	if len(subtitle) > 256 {
		common.ApiError(c, common.NewMessage("Package subtitle cannot exceed {{count}} characters", map[string]any{"count": 256}))
		return
	}
	pkg, err := model.UpdateTokenPackageDetails(packageId, userId, title, subtitle, strings.TrimSpace(request.Description))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	latestVersion, _ := model.GetLatestTokenPackageVersion(pkg.Id)
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, activeVersion, latestVersion))
}

// CreateSellerPackageVersion validates a version, runs the connection check,
// and routes it to review, automatic approval, or back to draft.
func CreateSellerPackageVersion(c *gin.Context) {
	userId := c.GetInt("id")
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pkg, err := model.GetTokenPackageForSeller(packageId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if pkg.Status == constant.TokenPackageStatusTerminated {
		common.ApiError(c, model.ErrTokenPackageState)
		return
	}
	request := dto.CreateTokenPackageVersionRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if pkg.BillingMode != constant.TokenPackageBillingModeQuota {
		common.ApiError(c, common.NewMessage("Only quota packages are available"))
		return
	}
	if err := service.ValidateTokenPackageVersionSpec(request.Models, request.SKUs); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := service.ValidateTokenPackageBindings(request.Channels, request.Models, userId); err != nil {
		common.ApiError(c, err)
		return
	}

	version := &model.TokenPackageVersion{}
	if err := version.SetModelSpecs(request.Models); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := version.SetSKUList(request.SKUs); err != nil {
		common.ApiError(c, err)
		return
	}
	bindings := make([]model.TokenPackageChannel, 0, len(request.Channels))
	for _, binding := range request.Channels {
		row := model.TokenPackageChannel{
			ChannelId: binding.ChannelID,
			Priority:  binding.Priority,
			Weight:    binding.Weight,
		}
		if row.Weight == 0 {
			row.Weight = 1
		}
		if err := row.SetModels(binding.Models); err != nil {
			common.ApiError(c, err)
			return
		}
		bindings = append(bindings, row)
	}
	if err := model.CreateTokenPackageVersion(packageId, version, bindings); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err := model.UpdateTokenPackageVersionStatus(version.Id, []string{constant.TokenPackageVersionStatusDraft}, constant.TokenPackageVersionStatusTesting, nil); err != nil {
		common.ApiError(c, err)
		return
	}

	// The connection check tests every bound channel against every model it
	// serves, which can take minutes; it runs as a system task. The version
	// stays in testing until the task routes it to review, approval or draft.
	if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeTokenPackageVersionCheck, nil); err != nil {
		common.SysError(common.LogText("failed to queue token package version check %d: %s", version.Id, err.Error()))
	}

	updatedPkg, err := model.GetTokenPackageForSeller(packageId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	approvedVersion, _ := model.GetApprovedTokenPackageVersion(updatedPkg)
	latestVersion, _ := model.GetLatestTokenPackageVersion(updatedPkg.Id)
	common.ApiSuccess(c, buildTokenPackageResponse(updatedPkg, approvedVersion, latestVersion))
}

// completeTokenPackageVersionCheck runs the connection check of one version in
// testing and routes it: a failed check returns it to draft with the report,
// a passed one goes to review, or is approved at once when the change needs no
// review or an administrator published it.
func completeTokenPackageVersionCheck(ctx context.Context, versionId int) error {
	version, err := model.GetTokenPackageVersion(versionId)
	if err != nil {
		return err
	}
	if version.Status != constant.TokenPackageVersionStatusTesting {
		return nil
	}
	pkg, err := model.GetTokenPackageById(version.PackageId)
	if err != nil {
		return err
	}
	if pkg.Status == constant.TokenPackageStatusTerminated {
		_, err := model.UpdateTokenPackageVersionStatus(version.Id, []string{constant.TokenPackageVersionStatusTesting}, constant.TokenPackageVersionStatusDraft, nil)
		return err
	}
	bindings, err := model.GetVersionChannels(version.Id)
	if err != nil {
		return err
	}
	report := runTokenPackageAutoCheck(ctx, pkg.SellerUserId, bindings)
	if err := saveTokenPackageTestReport(version.Id, report); err != nil {
		return err
	}
	if !report.Passed {
		_, err := model.UpdateTokenPackageVersionStatus(version.Id, []string{constant.TokenPackageVersionStatusTesting}, constant.TokenPackageVersionStatusDraft, nil)
		return err
	}

	previousVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	var previousSpecs []dto.TokenPackageModelSpec
	var previousSKUs []dto.TokenPackageSKU
	var previousBindingSpecs []dto.TokenPackageChannelBinding
	if previousVersion != nil {
		previousSpecs = previousVersion.GetModelSpecs()
		previousSKUs = previousVersion.GetSKUList()
		previousBindings, _ := model.GetVersionChannels(previousVersion.Id)
		for _, binding := range previousBindings {
			previousBindingSpecs = append(previousBindingSpecs, dto.TokenPackageChannelBinding{ChannelID: binding.ChannelId, Models: binding.GetModels()})
		}
	}
	nextBindingSpecs := make([]dto.TokenPackageChannelBinding, 0, len(bindings))
	for _, binding := range bindings {
		nextBindingSpecs = append(nextBindingSpecs, dto.TokenPackageChannelBinding{ChannelID: binding.ChannelId, Models: binding.GetModels()})
	}
	change := service.ClassifyTokenPackageVersionChange(previousSpecs, version.GetModelSpecs(), previousSKUs, version.GetSKUList(), previousBindingSpecs, nextBindingSpecs)

	skipReview := false
	if change == service.TokenPackageVersionChangeAutoEligible {
		skipReview = true
	} else if token_package_setting.GetTokenPackageSetting().AdminSkipReview {
		if user, err := model.GetUserById(pkg.SellerUserId, false); err == nil && user != nil && user.Role >= common.RoleAdminUser {
			skipReview = true
		}
	}
	// An upstream that answered with a different model than requested is the
	// clearest sign of a substituted model; a person must look at it.
	if slices.ContainsFunc(report.Results, func(item dto.TokenPackageChannelTestItem) bool { return item.ModelMismatch }) {
		skipReview = false
	}

	if _, err := model.UpdateTokenPackageVersionStatus(version.Id, []string{constant.TokenPackageVersionStatusTesting}, constant.TokenPackageVersionStatusPendingReview, map[string]any{"submitted_at": common.GetTimestamp()}); err != nil {
		return err
	}
	if !skipReview {
		return nil
	}
	if _, err := model.ApproveTokenPackageVersion(version.Id, 0, "Auto-approved after the connection check."); err != nil {
		return err
	}
	service.InvalidatePackagePricingCache(pkg.Id)
	return nil
}

// RunTokenPackageVersionChecks checks every version waiting in testing. A
// version interrupted by a restart is still in testing and is checked again.
func RunTokenPackageVersionChecks(ctx context.Context) (checked int, failed int) {
	versionIds, err := model.ListTestingTokenPackageVersionIds()
	if err != nil {
		common.SysError(common.LogText("failed to list token package versions to check: %s", err.Error()))
		return 0, 1
	}
	for _, versionId := range versionIds {
		if ctx.Err() != nil {
			break
		}
		if err := completeTokenPackageVersionCheck(ctx, versionId); err != nil {
			failed++
			common.SysError(common.LogText("failed to check token package version %d: %s", versionId, err.Error()))
			continue
		}
		checked++
	}
	return checked, failed
}

func StopSellerPackage(c *gin.Context) {
	userId := c.GetInt("id")
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pkg, err := model.StopTokenPackage(packageId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	latestVersion, _ := model.GetLatestTokenPackageVersion(pkg.Id)
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, activeVersion, latestVersion))
}

// RelistSellerPackage returns a stopped package to the market without a new
// review, as long as an approved version still exists.
func RelistSellerPackage(c *gin.Context) {
	userId := c.GetInt("id")
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pkg, err := model.GetTokenPackageForSeller(packageId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if pkg.ActiveVersionId <= 0 {
		common.ApiError(c, common.NewMessage("Submit a version before listing this package"))
		return
	}
	if _, err := model.GetApprovedTokenPackageVersion(pkg); err != nil {
		common.ApiError(c, common.NewMessage("Submit a version before listing this package"))
		return
	}
	pkg, err = model.SetTokenPackageStatus(packageId, []string{constant.TokenPackageStatusStopped}, constant.TokenPackageStatusListed)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	latestVersion, _ := model.GetLatestTokenPackageVersion(pkg.Id)
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, activeVersion, latestVersion))
}

func AdminListPackageReviews(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	page, pageSize := pageInfo.Page, pageInfo.PageSize
	versions, total, err := model.ListPendingReviewVersions(page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	items := make([]dto.TokenPackageReviewResponse, 0, len(versions))
	sellerNames := make(map[int]string)
	sellerIDs := make([]int, 0, len(versions))
	for _, version := range versions {
		pkg, err := model.GetTokenPackageById(version.PackageId)
		if err != nil {
			continue
		}
		if _, ok := sellerNames[pkg.SellerUserId]; !ok {
			sellerNames[pkg.SellerUserId] = ""
			sellerIDs = append(sellerIDs, pkg.SellerUserId)
		}
		item := dto.TokenPackageReviewResponse{
			Version:      buildTokenPackageVersionResponse(version, nil),
			SellerUserID: pkg.SellerUserId,
		}
		activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
		packageResponse := buildTokenPackageResponse(pkg, activeVersion, version)
		item.Package = &packageResponse
		bindings, _ := model.GetVersionChannels(version.Id)
		item.Version.Channels = buildTokenPackageVersionResponse(version, bindings).Channels
		items = append(items, item)
	}
	if len(sellerIDs) > 0 {
		names, err := model.GetUsernamesByIds(sellerIDs)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for userId, name := range names {
			sellerNames[userId] = name
		}
	}
	for i := range items {
		items[i].SellerName = sellerNames[items[i].SellerUserID]
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "page_size": pageSize})
}

func AdminApprovePackageVersion(c *gin.Context) {
	versionId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request := dto.ReviewTokenPackageVersionRequest{}
	_ = c.ShouldBindJSON(&request)
	version, err := model.ApproveTokenPackageVersion(versionId, c.GetInt("id"), strings.TrimSpace(request.ReviewNote))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	service.InvalidatePackagePricingCache(version.PackageId)
	common.ApiSuccess(c, buildTokenPackageVersionResponse(version, nil))
}

func AdminRejectPackageVersion(c *gin.Context) {
	versionId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request := dto.ReviewTokenPackageVersionRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	note := strings.TrimSpace(request.ReviewNote)
	if note == "" {
		common.ApiError(c, common.NewMessage("A rejection reason is required"))
		return
	}
	version, err := model.RejectTokenPackageVersion(versionId, c.GetInt("id"), note)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildTokenPackageVersionResponse(version, nil))
}

func AdminPausePackage(c *gin.Context) {
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pkg, err := model.SetTokenPackageStatus(packageId, []string{constant.TokenPackageStatusListed}, constant.TokenPackageStatusPaused)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, activeVersion, nil))
}

func AdminResumePackage(c *gin.Context) {
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pkg, err := model.SetTokenPackageStatus(packageId, []string{constant.TokenPackageStatusPaused}, constant.TokenPackageStatusListed)
	if err != nil {
		if errors.Is(err, model.ErrTokenPackageState) {
			common.ApiError(c, common.NewMessage("Only a paused package can be resumed"))
			return
		}
		common.ApiError(c, err)
		return
	}
	activeVersion, _ := model.GetApprovedTokenPackageVersion(pkg)
	common.ApiSuccess(c, buildTokenPackageResponse(pkg, activeVersion, nil))
}

// AdminTerminatePackage stops a package permanently and refunds buyers. The
// refund runs asynchronously because it has to wait for in-flight requests to
// settle before the unused balance is known.
func AdminTerminatePackage(c *gin.Context) {
	packageId, err := strconv.Atoi(c.Param("id"))
	if err != nil || packageId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	pkg, err := model.GetTokenPackageById(packageId)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgPackageUnavailable)
		return
	}
	// Mark the package first so no new request can start on it, then let the
	// termination task refund its buyers. The task sweeps every terminated
	// package with open entitlements, so terminating again after a crash, or
	// terminating two packages at once, always gets the refunds done.
	if _, err := service.MarkTokenPackageTerminated(pkg.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, _, err := service.EnqueueSystemTask(model.SystemTaskTypeTokenPackageTermination, nil); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"status": constant.TokenPackageStatusTerminated, "queued": true})
}
