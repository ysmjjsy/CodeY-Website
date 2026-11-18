package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// callUserChannelAPI drives a marketplace channel handler with the given user
// as the session identity, mirroring what the UserAuth middleware sets up.
func callUserChannelAPI(t *testing.T, userId int, handler gin.HandlerFunc, method, target, body string, params ...gin.Param) (map[string]any, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Set("id", userId)
	c.Set("role", common.RoleCommonUser)
	c.Request = httptest.NewRequest(method, target, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	handler(c)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &payload), recorder.Body.String())
	return payload, recorder.Body.String()
}

func channelIDParam(id int) gin.Param { return gin.Param{Key: "id", Value: strconv.Itoa(id)} }

func TestUserChannelCreateIsOwnerScopedAndHidesKey(t *testing.T) {
	setupChannelCreateTest(t)

	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "seller-a",
		"type": 1,
		"key": "sk-owner-secret",
		"models": ["gpt-4o", "gpt-4o-mini", "gpt-4o"],
		"model_mapping": {"gpt-4o": "gpt-4o-2024-08-06"}
	}`)
	require.Equal(t, true, payload["success"], raw)
	assert.NotContains(t, raw, "sk-owner-secret")

	data, ok := payload["data"].(map[string]any)
	require.True(t, ok, raw)
	channelId := int(data["id"].(float64))

	stored, err := model.GetChannelById(channelId, true)
	require.NoError(t, err)
	assert.Equal(t, 11, stored.OwnerUserId)
	assert.Empty(t, stored.Group, "marketplace channels must never join group routing")
	assert.Equal(t, "gpt-4o,gpt-4o-mini", stored.Models)
	assert.Equal(t, "sk-owner-secret", stored.Key)

	var abilities []model.Ability
	require.NoError(t, model.DB.Where("channel_id = ?", channelId).Find(&abilities).Error)
	assert.Empty(t, abilities, "owner channels must not create ability rows")

	// Another user cannot read, update, or delete the channel.
	payload, _ = callUserChannelAPI(t, 12, GetUserChannel, http.MethodGet, "/api/user/channels/1", "", channelIDParam(channelId))
	assert.Equal(t, false, payload["success"])
	payload, _ = callUserChannelAPI(t, 12, UpdateUserChannel, http.MethodPut, "/api/user/channels/1", `{"name":"stolen"}`, channelIDParam(channelId))
	assert.Equal(t, false, payload["success"])
	payload, _ = callUserChannelAPI(t, 12, DeleteUserChannel, http.MethodDelete, "/api/user/channels/1", "", channelIDParam(channelId))
	assert.Equal(t, false, payload["success"])
	payload, _ = callUserChannelAPI(t, 12, TestUserChannel, http.MethodPost, "/api/user/channels/1/test", "", channelIDParam(channelId))
	assert.Equal(t, false, payload["success"])

	// The owner updates a field; the key is untouched because it was not sent.
	payload, raw = callUserChannelAPI(t, 11, UpdateUserChannel, http.MethodPut, "/api/user/channels/1", `{"name":"seller-a-renamed"}`, channelIDParam(channelId))
	require.Equal(t, true, payload["success"], raw)
	stored, err = model.GetChannelById(channelId, true)
	require.NoError(t, err)
	assert.Equal(t, "seller-a-renamed", stored.Name)
	assert.Equal(t, "sk-owner-secret", stored.Key)

	payload, raw = callUserChannelAPI(t, 11, DeleteUserChannel, http.MethodDelete, "/api/user/channels/1", "", channelIDParam(channelId))
	require.Equal(t, true, payload["success"], raw)
	_, err = model.GetChannelForOwner(channelId, 11)
	assert.ErrorIs(t, err, model.ErrChannelNotFound)
}

func TestUserChannelRejectsDisallowedTypeAndPrivateTargets(t *testing.T) {
	setupChannelCreateTest(t)

	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "advanced",
		"type": 58,
		"key": "sk-x",
		"models": ["gpt-4o"]
	}`)
	assert.Equal(t, false, payload["success"], raw)

	payload, raw = callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "internal",
		"type": 1,
		"base_url": "http://127.0.0.1:8080",
		"key": "sk-x",
		"models": ["gpt-4o"]
	}`)
	assert.Equal(t, false, payload["success"], raw)

	payload, raw = callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "metadata",
		"type": 1,
		"base_url": "http://169.254.169.254",
		"key": "sk-x",
		"models": ["gpt-4o"]
	}`)
	assert.Equal(t, false, payload["success"], raw)

	assert.NoError(t, service.ValidateUserChannelBaseURL(""))
	assert.NoError(t, service.ValidateUserChannelBaseURL("https://93.184.216.34"))
	assert.Error(t, service.ValidateUserChannelBaseURL("ftp://api.example.com"))
	assert.Error(t, service.ValidateUserChannelBaseURL("http://10.0.0.5"))

	var count int64
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("owner_user_id = ?", 11).Count(&count).Error)
	assert.Zero(t, count)
	assert.Equal(t, constant.ChannelTypeAdvancedCustom, 58)
}

func TestUserChannelStoredKeyNeverLeavesTheStoredEndpoint(t *testing.T) {
	setupChannelCreateTest(t)
	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "seller-b",
		"type": 1,
		"key": "sk-stored-secret",
		"models": ["gpt-4o"]
	}`)
	require.Equal(t, true, payload["success"], raw)
	channelId := int(payload["data"].(map[string]any)["id"].(float64))

	// A preview that names another host but no key must not borrow the
	// stored one; it is refused before any upstream call.
	payload, raw = callUserChannelAPI(t, 11, FetchUserChannelModels, http.MethodPost,
		"/api/user/channel_models?channel_id="+strconv.Itoa(channelId), `{"base_url": "https://collector.example.com"}`)
	assert.Equal(t, false, payload["success"], raw)
	assert.NotContains(t, raw, "sk-stored-secret")
}

func TestUserChannelRejectsAVertexRegionThatNamesAHost(t *testing.T) {
	setupChannelCreateTest(t)
	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "vertex",
		"type": 41,
		"key": "{}",
		"other": "{\"default\": \"evil.example/x#\"}",
		"models": ["gemini-2.5-pro"]
	}`)
	assert.Equal(t, false, payload["success"], raw)
	assert.Contains(t, raw, "Vertex region")
}
