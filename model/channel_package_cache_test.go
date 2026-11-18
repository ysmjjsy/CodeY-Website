package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPackageRoutingTest(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := DB
	originalMemoryCache := common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&Channel{},
		&Ability{},
		&TokenPackage{},
		&TokenPackageVersion{},
		&TokenPackageChannel{},
	))
	DB = db
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCache
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func createPackageRoutingChannel(t *testing.T, ownerUserId int, name string, models []string, status int) *Channel {
	t.Helper()
	channel := &Channel{
		Name:        name,
		Type:        constant.ChannelTypeOpenAI,
		Key:         "sk-test",
		Status:      status,
		Models:      strings.Join(models, ","),
		OwnerUserId: ownerUserId,
	}
	require.NoError(t, DB.Create(channel).Error)
	return channel
}

func createRoutablePackage(t *testing.T, sellerUserId int, bindings []TokenPackageChannel) *TokenPackage {
	t.Helper()
	pkg := &TokenPackage{
		SellerUserId: sellerUserId,
		BillingMode:  constant.TokenPackageBillingModeQuota,
		Title:        "Routing package",
		Status:       constant.TokenPackageStatusListed,
	}
	require.NoError(t, DB.Create(pkg).Error)
	version := &TokenPackageVersion{
		PackageId: pkg.Id,
		VersionNo: 1,
		Status:    constant.TokenPackageVersionStatusApproved,
	}
	version.SetModelSpecs([]dto.TokenPackageModelSpec{{Model: "gpt-x", Multiplier: 1.5}})
	require.NoError(t, DB.Create(version).Error)
	for i := range bindings {
		bindings[i].VersionId = version.Id
		require.NoError(t, DB.Create(&bindings[i]).Error)
	}
	pkg.ActiveVersionId = version.Id
	require.NoError(t, DB.Model(pkg).Update("active_version_id", version.Id).Error)
	return pkg
}

func TestPackageRoutingStaysInsideBoundChannels(t *testing.T) {
	setupPackageRoutingTest(t)

	sellerChannel := createPackageRoutingChannel(t, 5, "seller-owned", []string{"gpt-x"}, common.ChannelStatusEnabled)
	unboundChannel := createPackageRoutingChannel(t, 5, "unbound", []string{"gpt-x"}, common.ChannelStatusEnabled)
	foreignBinding := createPackageRoutingChannel(t, 6, "foreign-owner", []string{"gpt-x"}, common.ChannelStatusEnabled)

	binding := &TokenPackageChannel{ChannelId: sellerChannel.Id}
	binding.Models = `["gpt-x"]`
	foreign := &TokenPackageChannel{ChannelId: foreignBinding.Id}
	foreign.Models = `["gpt-x"]`
	pkg := createRoutablePackage(t, 5, []TokenPackageChannel{*binding, *foreign})

	channel, err := GetRandomSatisfiedPackageChannel(pkg.Id, "gpt-x", 0, nil)
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, sellerChannel.Id, channel.Id, "only the seller's bound channel may serve the package")
	assert.NotEqual(t, unboundChannel.Id, channel.Id)
	assert.NotEqual(t, foreignBinding.Id, channel.Id)

	assert.True(t, IsChannelEnabledForPackageModel(pkg.Id, "gpt-x", sellerChannel.Id))
	assert.False(t, IsChannelEnabledForPackageModel(pkg.Id, "gpt-x", unboundChannel.Id))
	assert.False(t, IsChannelEnabledForPackageModel(pkg.Id, "gpt-x", foreignBinding.Id))

	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", sellerChannel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	channel, err = GetRandomSatisfiedPackageChannel(pkg.Id, "gpt-x", 0, nil)
	require.NoError(t, err)
	assert.Nil(t, channel, "a disabled bound channel must not be replaced by an unbound one")
}

func TestPackageRoutingIndexFiltersForeignAndDisabledChannels(t *testing.T) {
	setupPackageRoutingTest(t)

	sellerChannel := createPackageRoutingChannel(t, 5, "seller-owned", []string{"gpt-x"}, common.ChannelStatusEnabled)
	disabledChannel := createPackageRoutingChannel(t, 5, "disabled", []string{"gpt-x"}, common.ChannelStatusManuallyDisabled)
	foreignChannel := createPackageRoutingChannel(t, 6, "foreign", []string{"gpt-x"}, common.ChannelStatusEnabled)

	binding := &TokenPackageChannel{ChannelId: sellerChannel.Id}
	binding.Models = `["gpt-x"]`
	disabledBinding := &TokenPackageChannel{ChannelId: disabledChannel.Id}
	disabledBinding.Models = `["gpt-x"]`
	foreignBinding := &TokenPackageChannel{ChannelId: foreignChannel.Id}
	foreignBinding.Models = `["gpt-x"]`
	pkg := createRoutablePackage(t, 5, []TokenPackageChannel{*binding, *disabledBinding, *foreignBinding})

	index := buildPackageRoutingIndex(map[int]*Channel{
		sellerChannel.Id:   sellerChannel,
		disabledChannel.Id: disabledChannel,
		foreignChannel.Id:  foreignChannel,
	})
	candidates := index[pkg.Id]["gpt-x"]
	require.Len(t, candidates, 1)
	assert.Equal(t, sellerChannel.Id, candidates[0].ChannelId)
}
