package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserChannelExcludedFromAbilitiesAndGroupCache(t *testing.T) {
	setupChannelStatusTest(t)

	platformCh := &Channel{
		Name:   "platform-channel",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "sk-platform",
		Models: "gpt-4o",
		Group:  "default",
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, platformCh.Insert())

	// Even when Group takes DB default ('default'), a user-owned channel must never enter abilities or group2model2channels.
	userCh := &Channel{
		Name:        "user-channel",
		Type:        constant.ChannelTypeOpenAI,
		Key:         "sk-user",
		Models:      "gpt-4o,claude-3-5-sonnet",
		Status:      common.ChannelStatusEnabled,
		OwnerUserId: 42,
	}
	require.NoError(t, userCh.Insert())

	var storedUserCh Channel
	require.NoError(t, DB.First(&storedUserCh, userCh.Id).Error)
	assert.Equal(t, 42, storedUserCh.OwnerUserId)
	assert.Empty(t, storedUserCh.Group, "owner channels are stored with an empty group")

	var userAbilities int64
	require.NoError(t, DB.Model(&Ability{}).Where("channel_id = ?", userCh.Id).Count(&userAbilities).Error)
	assert.Zero(t, userAbilities)

	var platformAbilities int64
	require.NoError(t, DB.Model(&Ability{}).Where("channel_id = ?", platformCh.Id).Count(&platformAbilities).Error)
	assert.Equal(t, int64(1), platformAbilities)

	// Update and FixAbility must continue excluding user channels.
	storedUserCh.Models = "gpt-4o,gpt-4.1"
	require.NoError(t, storedUserCh.Update())
	require.NoError(t, DB.Model(&Ability{}).Where("channel_id = ?", userCh.Id).Count(&userAbilities).Error)
	assert.Zero(t, userAbilities)

	successCount, failCount, err := FixAbility()
	require.NoError(t, err)
	assert.Equal(t, 1, successCount)
	assert.Equal(t, 0, failCount)
	require.NoError(t, DB.Model(&Ability{}).Where("channel_id = ?", userCh.Id).Count(&userAbilities).Error)
	assert.Zero(t, userAbilities)

	// A row written before that rule existed can still carry the platform
	// default group; the cache must exclude it anyway.
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", userCh.Id).Update("group", "default").Error)

	// Enable memory cache and verify group2model2channels excludes userCh while channelsIDM retains it.
	previousMemoryCache := common.MemoryCacheEnabled
	t.Cleanup(func() { common.MemoryCacheEnabled = previousMemoryCache })
	common.MemoryCacheEnabled = true
	InitChannelCache()

	cachedUser, err := CacheGetChannel(userCh.Id)
	require.NoError(t, err)
	assert.Equal(t, 42, cachedUser.OwnerUserId)

	for range 10 {
		selected, err := GetRandomSatisfiedChannel("default", "gpt-4o", 0, nil)
		require.NoError(t, err)
		require.NotNil(t, selected)
		assert.Equal(t, platformCh.Id, selected.Id)

		none, err := GetRandomSatisfiedChannel("default", "claude-3-5-sonnet", 0, nil)
		require.NoError(t, err)
		assert.Nil(t, none)
	}

	// Verify DB-fallback routing also behaves identically for platform channels and skips user channels.
	common.MemoryCacheEnabled = false
	selectedDB, err := GetChannel("default", "gpt-4o", 0, nil)
	require.NoError(t, err)
	require.NotNil(t, selectedDB)
	assert.Equal(t, platformCh.Id, selectedDB.Id)

	noneDB, err := GetChannel("default", "claude-3-5-sonnet", 0, nil)
	require.NoError(t, err)
	assert.Nil(t, noneDB)
}

func TestTagBatchOperationsAndDeleteDisabledExcludeUserChannels(t *testing.T) {
	setupChannelStatusTest(t)

	sharedTag := "shared-tag"
	newTag := "renamed-tag"
	batchTag := "batch-tag"

	platformCh := &Channel{
		Name:   "platform-tagged",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "sk-plat",
		Models: "gpt-4o",
		Group:  "default",
		Tag:    &sharedTag,
		Status: common.ChannelStatusEnabled,
	}
	require.NoError(t, platformCh.Insert())

	userCh := &Channel{
		Name:        "user-tagged",
		Type:        constant.ChannelTypeOpenAI,
		Key:         "sk-usr",
		Models:      "gpt-4o",
		Tag:         &sharedTag,
		Status:      common.ChannelStatusEnabled,
		OwnerUserId: 77,
	}
	require.NoError(t, userCh.Insert())

	// Seed a synthetic stale ability row to verify UpdateAbilityStatusByTag / UpdateAbilityByTag also filter owner_user_id = 0.
	require.NoError(t, DB.Create(&Ability{
		Group:     "default",
		Model:     "gpt-4o",
		ChannelId: userCh.Id,
		Enabled:   true,
		Tag:       &sharedTag,
	}).Error)

	require.NoError(t, DisableChannelByTag(sharedTag))

	var gotPlat, gotUser Channel
	require.NoError(t, DB.First(&gotPlat, platformCh.Id).Error)
	require.NoError(t, DB.First(&gotUser, userCh.Id).Error)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, gotPlat.Status)
	assert.Equal(t, common.ChannelStatusEnabled, gotUser.Status)

	var userAbility Ability
	require.NoError(t, DB.First(&userAbility, "channel_id = ?", userCh.Id).Error)
	assert.True(t, userAbility.Enabled)

	require.NoError(t, EnableChannelByTag(sharedTag))
	require.NoError(t, DB.First(&gotPlat, platformCh.Id).Error)
	assert.Equal(t, common.ChannelStatusEnabled, gotPlat.Status)

	// EditChannelByTag updates platform channel tag but leaves user channel tag intact.
	newPriority := int64(9)
	require.NoError(t, EditChannelByTag(sharedTag, &newTag, nil, nil, nil, &newPriority, nil, nil, nil))
	require.NoError(t, DB.First(&gotPlat, platformCh.Id).Error)
	require.NoError(t, DB.First(&gotUser, userCh.Id).Error)
	require.NotNil(t, gotPlat.Tag)
	assert.Equal(t, newTag, *gotPlat.Tag)
	assert.Equal(t, int64(9), gotPlat.GetPriority())
	require.NotNil(t, gotUser.Tag)
	assert.Equal(t, sharedTag, *gotUser.Tag)

	// BatchSetChannelTag updates platform channel only.
	require.NoError(t, BatchSetChannelTag([]int{platformCh.Id, userCh.Id}, &batchTag))
	require.NoError(t, DB.First(&gotPlat, platformCh.Id).Error)
	require.NoError(t, DB.First(&gotUser, userCh.Id).Error)
	require.NotNil(t, gotPlat.Tag)
	assert.Equal(t, batchTag, *gotPlat.Tag)
	require.NotNil(t, gotUser.Tag)
	assert.Equal(t, sharedTag, *gotUser.Tag)

	// DeleteDisabledChannel deletes disabled platform channel, preserves disabled user channel.
	require.NoError(t, DB.Model(&Channel{}).Where("id IN ?", []int{platformCh.Id, userCh.Id}).Update("status", common.ChannelStatusManuallyDisabled).Error)
	deleted, err := DeleteDisabledChannel()
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)

	var platCount, userCount int64
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", platformCh.Id).Count(&platCount).Error)
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", userCh.Id).Count(&userCount).Error)
	assert.Zero(t, platCount)
	assert.Equal(t, int64(1), userCount)
}

func TestChannelOwnerFilterParsingAndSearch(t *testing.T) {
	setupChannelStatusTest(t)

	plat := &Channel{Name: "alpha-platform", Type: constant.ChannelTypeOpenAI, Key: "sk-1", Models: "gpt-4o", Group: "default", Status: common.ChannelStatusEnabled}
	userA := &Channel{Name: "alpha-user-a", Type: constant.ChannelTypeOpenAI, Key: "sk-2", Models: "gpt-4o", Status: common.ChannelStatusEnabled, OwnerUserId: 101}
	userB := &Channel{Name: "alpha-user-b", Type: constant.ChannelTypeOpenAI, Key: "sk-3", Models: "gpt-4o", Status: common.ChannelStatusEnabled, OwnerUserId: 202}
	require.NoError(t, plat.Insert())
	require.NoError(t, userA.Insert())
	require.NoError(t, userB.Insert())

	for _, tc := range []struct {
		raw     string
		wantIDs []int
		wantErr bool
	}{
		{raw: "", wantIDs: []int{plat.Id}},
		{raw: "platform", wantIDs: []int{plat.Id}},
		{raw: "0", wantIDs: []int{plat.Id}},
		{raw: "user", wantIDs: []int{userB.Id, userA.Id}},
		{raw: "101", wantIDs: []int{userA.Id}},
		{raw: "all", wantIDs: []int{userB.Id, userA.Id, plat.Id}},
		{raw: "invalid-owner", wantErr: true},
		{raw: "-5", wantErr: true},
	} {
		filter, err := ParseChannelOwnerFilter(tc.raw)
		if tc.wantErr {
			assert.Error(t, err, tc.raw)
			continue
		}
		require.NoError(t, err, tc.raw)
		found, err := SearchChannelsWithOwner("alpha", "", "", true, filter)
		require.NoError(t, err, tc.raw)
		gotIDs := make([]int, 0, len(found))
		for _, ch := range found {
			gotIDs = append(gotIDs, ch.Id)
		}
		assert.ElementsMatch(t, tc.wantIDs, gotIDs, tc.raw)
	}
}
