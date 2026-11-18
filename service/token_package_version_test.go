package service

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTokenPackageVersionTest(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupSellerEligibilityTest(t)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.TokenPackageVersion{}, &model.TokenPackageChannel{}, &model.SystemTask{}))
	return db
}

func tokenPackageTestChannel(t *testing.T, ownerUserId int, models string, status int) *model.Channel {
	t.Helper()
	channel := &model.Channel{
		Name:        "seller-channel",
		Type:        constant.ChannelTypeOpenAI,
		Key:         "sk-seller",
		Models:      models,
		Status:      status,
		OwnerUserId: ownerUserId,
	}
	require.NoError(t, model.DB.Create(channel).Error)
	return channel
}

func TestClassifyTokenPackageVersionChange(t *testing.T) {
	baseSpecs := []dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.8}}
	baseSKUs := []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 1000, CreditQuota: 1200, ValidDays: 30}}
	bindings := []dto.TokenPackageChannelBinding{{ChannelID: 1, Models: []string{"gpt-4o"}}}

	cases := []struct {
		name      string
		previous  bool
		specs     []dto.TokenPackageModelSpec
		skus      []dto.TokenPackageSKU
		bindings  []dto.TokenPackageChannelBinding
		expected  TokenPackageVersionChange
		rationale string
	}{
		{
			name:      "initial version",
			previous:  false,
			specs:     baseSpecs,
			skus:      baseSKUs,
			bindings:  bindings,
			expected:  TokenPackageVersionChangeInitial,
			rationale: "no approved version exists yet",
		},
		{
			name:      "price drop",
			previous:  true,
			specs:     baseSpecs,
			skus:      []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 900, CreditQuota: 1200, ValidDays: 30}},
			bindings:  bindings,
			expected:  TokenPackageVersionChangeAutoEligible,
			rationale: "buyers pay less",
		},
		{
			name:      "extra sku",
			previous:  true,
			specs:     baseSpecs,
			skus:      append(baseSKUs, dto.TokenPackageSKU{SKUKey: "pro", Title: "Pro", PriceQuota: 2000, CreditQuota: 2400, ValidDays: 30}),
			bindings:  bindings,
			expected:  TokenPackageVersionChangeAutoEligible,
			rationale: "a new option never harms existing buyers",
		},
		{
			name:      "multiplier drop",
			previous:  true,
			specs:     []dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.7}},
			skus:      baseSKUs,
			bindings:  bindings,
			expected:  TokenPackageVersionChangeAutoEligible,
			rationale: "cheaper per-token price",
		},
		{
			name:      "price increase",
			previous:  true,
			specs:     baseSpecs,
			skus:      []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 1200, CreditQuota: 1200, ValidDays: 30}},
			bindings:  bindings,
			expected:  TokenPackageVersionChangeRequiresReview,
			rationale: "buyers pay more",
		},
		{
			name:      "multiplier increase",
			previous:  true,
			specs:     []dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.9}},
			skus:      baseSKUs,
			bindings:  bindings,
			expected:  TokenPackageVersionChangeRequiresReview,
			rationale: "charges more per token",
		},
		{
			name:      "model added",
			previous:  true,
			specs:     []dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.8}, {Model: "gpt-4o-mini", Multiplier: 0.5}},
			skus:      baseSKUs,
			bindings:  bindings,
			expected:  TokenPackageVersionChangeRequiresReview,
			rationale: "changes the served surface",
		},
		{
			name:      "sku removed",
			previous:  true,
			specs:     baseSpecs,
			skus:      []dto.TokenPackageSKU{{SKUKey: "pro", Title: "Pro", PriceQuota: 2000, CreditQuota: 2400, ValidDays: 30}},
			bindings:  bindings,
			expected:  TokenPackageVersionChangeRequiresReview,
			rationale: "an offered SKU disappears",
		},
		{
			name:      "binding changed",
			previous:  true,
			specs:     baseSpecs,
			skus:      baseSKUs,
			bindings:  []dto.TokenPackageChannelBinding{{ChannelID: 2, Models: []string{"gpt-4o"}}},
			expected:  TokenPackageVersionChangeRequiresReview,
			rationale: "traffic moves to another upstream",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			previousSpecs, previousSKUs, previousBindings := baseSpecs, baseSKUs, bindings
			if !tc.previous {
				previousSpecs, previousSKUs, previousBindings = nil, nil, nil
			}
			actual := ClassifyTokenPackageVersionChange(previousSpecs, tc.specs, previousSKUs, tc.skus, previousBindings, tc.bindings)
			assert.Equal(t, tc.expected, actual, tc.rationale)
		})
	}
}

func TestValidateTokenPackageVersionSpecAndBindings(t *testing.T) {
	setupTokenPackageVersionTest(t)
	sellerChannel := tokenPackageTestChannel(t, 7, "gpt-4o", common.ChannelStatusEnabled)
	foreignChannel := tokenPackageTestChannel(t, 9, "gpt-4o", common.ChannelStatusEnabled)
	disabledChannel := tokenPackageTestChannel(t, 7, "gpt-4o", common.ChannelStatusManuallyDisabled)

	specs := []dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.5}}
	skus := []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 1000, CreditQuota: 1200, ValidDays: 30}}

	assert.NoError(t, ValidateTokenPackageVersionSpec(specs, skus))
	assert.Error(t, ValidateTokenPackageVersionSpec(nil, skus))
	assert.Error(t, ValidateTokenPackageVersionSpec([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0}}, skus))
	assert.Error(t, ValidateTokenPackageVersionSpec([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 20}}, skus))
	assert.Error(t, ValidateTokenPackageVersionSpec([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 0.5}, {Model: "gpt-4o", Multiplier: 0.6}}, skus))
	assert.Error(t, ValidateTokenPackageVersionSpec(specs, nil))
	assert.Error(t, ValidateTokenPackageVersionSpec(specs, []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 0, CreditQuota: 1, ValidDays: 1}}))
	assert.Error(t, ValidateTokenPackageVersionSpec(specs, []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 1, CreditQuota: 1, ValidDays: 0}}))

	assert.NoError(t, ValidateTokenPackageBindings([]dto.TokenPackageChannelBinding{{ChannelID: sellerChannel.Id, Models: []string{"gpt-4o"}}}, specs, 7))
	assert.Error(t, ValidateTokenPackageBindings(nil, specs, 7))
	assert.Error(t, ValidateTokenPackageBindings([]dto.TokenPackageChannelBinding{{ChannelID: foreignChannel.Id, Models: []string{"gpt-4o"}}}, specs, 7))
	assert.Error(t, ValidateTokenPackageBindings([]dto.TokenPackageChannelBinding{{ChannelID: disabledChannel.Id, Models: []string{"gpt-4o"}}}, specs, 7))
	assert.Error(t, ValidateTokenPackageBindings([]dto.TokenPackageChannelBinding{{ChannelID: sellerChannel.Id, Models: []string{"gpt-4o-mini"}}}, specs, 7))
	assert.Error(t, ValidateTokenPackageBindings([]dto.TokenPackageChannelBinding{{ChannelID: sellerChannel.Id, Models: nil}}, specs, 7))
}

func TestTokenPackageVersionApprovalLifecycle(t *testing.T) {
	setupTokenPackageVersionTest(t)
	channel := tokenPackageTestChannel(t, 7, "gpt-4o,gpt-4o-mini", common.ChannelStatusEnabled)

	pkg := &model.TokenPackage{SellerUserId: 7, Title: "Starter", BillingMode: constant.TokenPackageBillingModeQuota, Status: constant.TokenPackageStatusDraft}
	require.NoError(t, model.CreateTokenPackage(pkg))

	newVersion := func(modelName string, price int64) *model.TokenPackageVersion {
		version := &model.TokenPackageVersion{}
		require.NoError(t, version.SetModelSpecs([]dto.TokenPackageModelSpec{{Model: modelName, Multiplier: 0.5}}))
		require.NoError(t, version.SetSKUList([]dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: price, CreditQuota: 1200, ValidDays: 30}}))
		binding := model.TokenPackageChannel{ChannelId: channel.Id, Weight: 1}
		require.NoError(t, binding.SetModels([]string{modelName}))
		require.NoError(t, model.CreateTokenPackageVersion(pkg.Id, version, []model.TokenPackageChannel{binding}))
		return version
	}
	submit := func(version *model.TokenPackageVersion) {
		_, err := model.UpdateTokenPackageVersionStatus(version.Id, []string{constant.TokenPackageVersionStatusDraft}, constant.TokenPackageVersionStatusPendingReview, map[string]any{"submitted_at": common.GetTimestamp()})
		require.NoError(t, err)
	}

	first := newVersion("gpt-4o", 1000)
	assert.Equal(t, 1, first.VersionNo)
	submit(first)
	var syncTasksBefore int64
	require.NoError(t, model.DB.Model(&model.SystemTask{}).Where("type = ?", model.SyncTaskType(model.SyncTopicChannels)).Count(&syncTasksBefore).Error)
	approved, err := model.ApproveTokenPackageVersion(first.Id, 1, "looks good")
	require.NoError(t, err)
	assert.Equal(t, constant.TokenPackageVersionStatusApproved, approved.Status)
	var syncTasksAfter int64
	require.NoError(t, model.DB.Model(&model.SystemTask{}).Where("type = ?", model.SyncTaskType(model.SyncTopicChannels)).Count(&syncTasksAfter).Error)
	assert.Equal(t, syncTasksBefore+1, syncTasksAfter, "approval asks every node to rebuild the package routing index")

	storedPkg, err := model.GetTokenPackageById(pkg.Id)
	require.NoError(t, err)
	assert.Equal(t, constant.TokenPackageStatusListed, storedPkg.Status)
	assert.Equal(t, first.Id, storedPkg.ActiveVersionId)

	second := newVersion("gpt-4o-mini", 900)
	assert.Equal(t, 2, second.VersionNo)
	submit(second)
	_, err = model.ApproveTokenPackageVersion(second.Id, 1, "cheaper")
	require.NoError(t, err)

	superseded, err := model.GetTokenPackageVersion(first.Id)
	require.NoError(t, err)
	assert.Equal(t, constant.TokenPackageVersionStatusSuperseded, superseded.Status)

	storedPkg, err = model.GetTokenPackageById(pkg.Id)
	require.NoError(t, err)
	assert.Equal(t, second.Id, storedPkg.ActiveVersionId)

	_, err = model.ApproveTokenPackageVersion(first.Id, 1, "again")
	assert.ErrorIs(t, err, model.ErrTokenPackageVersionState)

	third := newVersion("gpt-4o", 1200)
	submit(third)
	rejected, err := model.RejectTokenPackageVersion(third.Id, 1, "price is too high")
	require.NoError(t, err)
	assert.Equal(t, constant.TokenPackageVersionStatusRejected, rejected.Status)
	assert.Equal(t, "price is too high", rejected.ReviewNote)

	_, err = model.ApproveTokenPackageVersion(third.Id, 1, "")
	assert.ErrorIs(t, err, model.ErrTokenPackageVersionState)

	_, err = model.StopTokenPackage(pkg.Id, 99)
	assert.ErrorIs(t, err, model.ErrTokenPackageState)
	stopped, err := model.StopTokenPackage(pkg.Id, 7)
	require.NoError(t, err)
	assert.Equal(t, constant.TokenPackageStatusStopped, stopped.Status)
}

func TestTokenPackageVersionLimitsAndModelCoverage(t *testing.T) {
	setupTokenPackageVersionTest(t)
	channel := tokenPackageTestChannel(t, 7, "gpt-4o,o3", common.ChannelStatusEnabled)
	skus := []dto.TokenPackageSKU{{SKUKey: "basic", Title: "Basic", PriceQuota: 1000, CreditQuota: 1200, ValidDays: 30}}

	tooManyModels := make([]dto.TokenPackageModelSpec, 0, MaxTokenPackageVersionModels+1)
	for i := range MaxTokenPackageVersionModels + 1 {
		tooManyModels = append(tooManyModels, dto.TokenPackageModelSpec{Model: fmt.Sprintf("model-%d", i), Multiplier: 1})
	}
	assert.Error(t, ValidateTokenPackageVersionSpec(tooManyModels, skus), "the connection check size stays bounded")
	assert.Error(t, ValidateTokenPackageVersionSpec([]dto.TokenPackageModelSpec{{Model: "gpt-4o", Multiplier: 1}},
		[]dto.TokenPackageSKU{{SKUKey: "huge", Title: "Huge", PriceQuota: common.MaxWalletQuota + 1, CreditQuota: 1, ValidDays: 30}}),
		"a price beyond the wallet boundary is refused")

	specs := []dto.TokenPackageModelSpec{{Model: " gpt-4o ", Multiplier: 1}, {Model: "o3", Multiplier: 1}}
	require.NoError(t, ValidateTokenPackageVersionSpec(specs, skus))
	assert.Equal(t, "gpt-4o", specs[0].Model, "model names are stored trimmed")

	onlyFirst := []dto.TokenPackageChannelBinding{{ChannelID: channel.Id, Models: []string{"gpt-4o"}}}
	assert.Error(t, ValidateTokenPackageBindings(onlyFirst, specs, 7), "a listed model no channel serves is refused")

	heavy := []dto.TokenPackageChannelBinding{{ChannelID: channel.Id, Models: []string{"gpt-4o", "o3"}, Weight: model.MaxTokenPackageBindingWeight + 1}}
	assert.Error(t, ValidateTokenPackageBindings(heavy, specs, 7), "an unbounded weight would overflow routing")

	both := []dto.TokenPackageChannelBinding{{ChannelID: channel.Id, Models: []string{"gpt-4o", "o3"}, Weight: 10}}
	assert.NoError(t, ValidateTokenPackageBindings(both, specs, 7))
}
