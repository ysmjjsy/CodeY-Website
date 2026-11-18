package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminChannelListAndSearchOwnerFilter(t *testing.T) {
	setupChannelCreateTest(t)

	platTag := "tag-shared"
	userTag := "tag-shared"
	plat := &model.Channel{Name: "plat-ch", Type: constant.ChannelTypeOpenAI, Key: "sk-p", Models: "gpt-4o", Group: "default", Tag: &platTag, Status: common.ChannelStatusEnabled}
	userCh := &model.Channel{Name: "user-ch", Type: constant.ChannelTypeOpenAI, Key: "sk-u", Models: "gpt-4o", Tag: &userTag, Status: common.ChannelStatusEnabled, OwnerUserId: 88}
	require.NoError(t, plat.Insert())
	require.NoError(t, userCh.Insert())

	extractIDs := func(raw json.RawMessage) []int {
		var payload struct {
			Items []model.Channel `json:"items"`
		}
		require.NoError(t, json.Unmarshal(raw, &payload))
		ids := make([]int, 0, len(payload.Items))
		for _, ch := range payload.Items {
			ids = append(ids, ch.Id)
		}
		return ids
	}

	// Default owner is platform.
	resp, _ := callChannelAPI(t, GetAllChannels, http.MethodGet, "/api/channel/", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{plat.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, GetAllChannels, http.MethodGet, "/api/channel/?owner=user", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{userCh.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, GetAllChannels, http.MethodGet, "/api/channel/?owner=88", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{userCh.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, GetAllChannels, http.MethodGet, "/api/channel/?owner=all", "")
	require.True(t, resp.Success)
	assert.ElementsMatch(t, []int{plat.Id, userCh.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, GetAllChannels, http.MethodGet, "/api/channel/?owner=bad", "")
	assert.False(t, resp.Success)

	// SearchChannels (normal + tag_mode)
	resp, _ = callChannelAPI(t, SearchChannels, http.MethodGet, "/api/channel/search?keyword=ch", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{plat.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, SearchChannels, http.MethodGet, "/api/channel/search?keyword=ch&owner=user", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{userCh.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, SearchChannels, http.MethodGet, "/api/channel/search?tag_mode=true&owner=platform", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{plat.Id}, extractIDs(resp.Data))

	resp, _ = callChannelAPI(t, SearchChannels, http.MethodGet, "/api/channel/search?tag_mode=true&owner=88", "")
	require.True(t, resp.Success)
	assert.Equal(t, []int{userCh.Id}, extractIDs(resp.Data))
}

func TestUpdateChannelRejectsGroupAndTagOnUserChannel(t *testing.T) {
	setupChannelCreateTest(t)

	userCh := &model.Channel{
		Name:        "seller-owned",
		Type:        constant.ChannelTypeOpenAI,
		Key:         "sk-seller",
		Models:      "gpt-4o",
		Status:      common.ChannelStatusEnabled,
		OwnerUserId: 55,
	}
	require.NoError(t, userCh.Insert())

	resp, _ := callChannelAPI(t, UpdateChannel, http.MethodPut, "/api/channel/", fmt.Sprintf(`{"id":%d,"group":"vip"}`, userCh.Id))
	assert.False(t, resp.Success)

	resp, _ = callChannelAPI(t, UpdateChannel, http.MethodPut, "/api/channel/", fmt.Sprintf(`{"id":%d,"group":"default"}`, userCh.Id))
	assert.False(t, resp.Success)

	resp, _ = callChannelAPI(t, UpdateChannel, http.MethodPut, "/api/channel/", fmt.Sprintf(`{"id":%d,"tag":"admin-tag"}`, userCh.Id))
	assert.False(t, resp.Success)

	// Renaming without setting group/tag succeeds and keeps OwnerUserId intact.
	resp, _ = callChannelAPI(t, UpdateChannel, http.MethodPut, "/api/channel/", fmt.Sprintf(`{"id":%d,"name":"seller-owned-renamed"}`, userCh.Id))
	assert.True(t, resp.Success, resp.Message)

	stored, err := model.GetChannelById(userCh.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "seller-owned-renamed", stored.Name)
	assert.Equal(t, 55, stored.OwnerUserId)

	// CopyChannel rejects user-owned channels.
	resp, _ = callChannelAPI(t, CopyChannel, http.MethodPost, fmt.Sprintf("/api/channel/copy/%d", userCh.Id), "", idParam(userCh.Id))
	assert.False(t, resp.Success)
}

func TestDeleteDisabledChannelSkipsUserChannels(t *testing.T) {
	setupChannelCreateTest(t)

	plat := &model.Channel{Name: "plat-disabled", Type: constant.ChannelTypeOpenAI, Key: "sk-pd", Models: "gpt-4o", Group: "default", Status: common.ChannelStatusManuallyDisabled}
	userCh := &model.Channel{Name: "user-disabled", Type: constant.ChannelTypeOpenAI, Key: "sk-ud", Models: "gpt-4o", Status: common.ChannelStatusManuallyDisabled, OwnerUserId: 99}
	require.NoError(t, plat.Insert())
	require.NoError(t, userCh.Insert())

	resp, _ := callChannelAPI(t, DeleteDisabledChannel, http.MethodDelete, "/api/channel/disabled", "")
	require.True(t, resp.Success)
	var deletedCount int64
	require.NoError(t, json.Unmarshal(resp.Data, &deletedCount))
	assert.Equal(t, int64(1), deletedCount)

	var platCount, userCount int64
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", plat.Id).Count(&platCount).Error)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", userCh.Id).Count(&userCount).Error)
	assert.Zero(t, platCount)
	assert.Equal(t, int64(1), userCount)
}
