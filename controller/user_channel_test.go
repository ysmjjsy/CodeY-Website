package controller

import (
	"encoding/json"
	"fmt"
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
	"github.com/QuantumNous/new-api/pkg/jsplugin"
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
	c.Set("session_id", fmt.Sprintf("user-session-%d", userId))
	c.Set("auth_version", int64(1))
	c.Set("session_version", int64(1))
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

func TestUserChannelProviderSettingsRoundTrip(t *testing.T) {
	setupChannelCreateTest(t)

	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "seller-aws",
		"type": 33,
		"key": "AK|SK|us-east-1",
		"models": ["claude-3-5-sonnet"],
		"settings": {
			"aws_key_type": "api_key",
			"aws_api_type": "mantle"
		}
	}`)
	require.Equal(t, true, payload["success"], raw)
	data := payload["data"].(map[string]any)
	channelId := int(data["id"].(float64))
	settings := data["settings"].(map[string]any)
	assert.Equal(t, "api_key", settings["aws_key_type"])
	assert.Equal(t, "mantle", settings["aws_api_type"])

	stored, err := model.GetChannelById(channelId, true)
	require.NoError(t, err)
	storedSettings := stored.GetOtherSettings()
	assert.Equal(t, "api_key", string(storedSettings.AwsKeyType))
	assert.Equal(t, "mantle", string(storedSettings.AwsApiType))

	payload, raw = callUserChannelAPI(t, 11, UpdateUserChannel, http.MethodPut, "/api/user/channels/1", `{
		"settings": {
			"aws_key_type": "ak_sk",
			"aws_api_type": "invoke_model"
		}
	}`, channelIDParam(channelId))
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	settings = data["settings"].(map[string]any)
	assert.Equal(t, "ak_sk", settings["aws_key_type"])
	assert.Equal(t, "invoke_model", settings["aws_api_type"])
}

func TestUserChannelOpenAIOrganizationRoundTrip(t *testing.T) {
	setupChannelCreateTest(t)

	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", `{
		"name": "seller-openai",
		"type": 1,
		"key": "sk-openai",
		"openai_organization": " org-seller ",
		"models": ["gpt-4o"]
	}`)
	require.Equal(t, true, payload["success"], raw)
	data := payload["data"].(map[string]any)
	channelId := int(data["id"].(float64))
	assert.Equal(t, "org-seller", data["openai_organization"])

	stored, err := model.GetChannelById(channelId, true)
	require.NoError(t, err)
	require.NotNil(t, stored.OpenAIOrganization)
	assert.Equal(t, "org-seller", *stored.OpenAIOrganization)

	payload, raw = callUserChannelAPI(t, 11, UpdateUserChannel, http.MethodPut, "/api/user/channels/1", `{
		"openai_organization": ""
	}`, channelIDParam(channelId))
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	assert.Equal(t, "", data["openai_organization"])

	stored, err = model.GetChannelById(channelId, true)
	require.NoError(t, err)
	require.NotNil(t, stored.OpenAIOrganization)
	assert.Equal(t, "", *stored.OpenAIOrganization)
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

func createTestUserChannel(t *testing.T, userId int, name string, channelType int) int {
	t.Helper()
	body := fmt.Sprintf(`{
		"name": %q,
		"type": %d,
		"key": "sk-test",
		"models": ["gpt-4o"]
	}`, name, channelType)
	payload, raw := callUserChannelAPI(t, userId, CreateUserChannel, http.MethodPost, "/api/user/channels", body)
	require.Equal(t, true, payload["success"], raw)
	data, ok := payload["data"].(map[string]any)
	require.True(t, ok, raw)
	return int(data["id"].(float64))
}

func TestUserChannelsPaginationAndFilters(t *testing.T) {
	setupChannelCreateTest(t)

	first := createTestUserChannel(t, 11, "alpha-openai", 1)
	second := createTestUserChannel(t, 11, "beta-openai", 1)
	third := createTestUserChannel(t, 11, "gamma-anthropic", 14)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", second).Update("status", common.ChannelStatusManuallyDisabled).Error)

	payload, raw := callUserChannelAPI(t, 11, GetUserChannels, http.MethodGet, "/api/user/channels?p=1&page_size=2", "")
	require.Equal(t, true, payload["success"], raw)
	data := payload["data"].(map[string]any)
	assert.Equal(t, float64(3), data["total"])
	assert.Equal(t, float64(1), data["page"])
	assert.Equal(t, float64(2), data["page_size"])
	assert.Len(t, data["items"].([]any), 2)

	payload, raw = callUserChannelAPI(t, 11, GetUserChannels, http.MethodGet, "/api/user/channels?type=1&status=enabled", "")
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	assert.Equal(t, float64(1), data["total"])
	items := data["items"].([]any)
	require.Len(t, items, 1)
	assert.Equal(t, float64(first), items[0].(map[string]any)["id"])
	assert.NotEqual(t, float64(third), items[0].(map[string]any)["id"])

	payload, raw = callUserChannelAPI(t, 11, GetUserChannels, http.MethodGet, "/api/user/channels?keyword=gamma", "")
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	assert.Equal(t, float64(1), data["total"])
	items = data["items"].([]any)
	require.Len(t, items, 1)
	assert.Equal(t, float64(third), items[0].(map[string]any)["id"])

	pkg := &model.TokenPackage{
		SellerUserId: 11,
		Title:        "bound package",
		Status:       constant.TokenPackageStatusListed,
	}
	require.NoError(t, model.DB.Create(pkg).Error)
	version := &model.TokenPackageVersion{
		PackageId: pkg.Id,
		VersionNo: 1,
		Status:    constant.TokenPackageVersionStatusApproved,
	}
	require.NoError(t, model.DB.Create(version).Error)
	pkg.ActiveVersionId = version.Id
	require.NoError(t, model.DB.Save(pkg).Error)
	require.NoError(t, model.DB.Create(&model.TokenPackageChannel{
		VersionId: version.Id,
		ChannelId: first,
	}).Error)

	payload, raw = callUserChannelAPI(t, 11, GetUserChannels, http.MethodGet, "/api/user/channels?bound=bound", "")
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	assert.Equal(t, float64(1), data["total"])
	items = data["items"].([]any)
	require.Len(t, items, 1)
	assert.Equal(t, float64(first), items[0].(map[string]any)["id"])

	payload, raw = callUserChannelAPI(t, 11, GetUserChannels, http.MethodGet, "/api/user/channels?bound=unbound", "")
	require.Equal(t, true, payload["success"], raw)
	data = payload["data"].(map[string]any)
	assert.Equal(t, float64(2), data["total"])
}

func TestUserChannelBatchReportsPerChannelFailures(t *testing.T) {
	setupChannelCreateTest(t)

	enabledId := createTestUserChannel(t, 11, "batch-enabled", 1)
	autoDisabledId := createTestUserChannel(t, 11, "batch-auto-disabled", 1)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", autoDisabledId).Update("status", common.ChannelStatusAutoDisabled).Error)

	payload, raw := callUserChannelAPI(t, 11, BatchUserChannels, http.MethodPost, "/api/user/channel-batch",
		fmt.Sprintf(`{"action":"enable","ids":[%d,%d]}`, enabledId, autoDisabledId))
	require.Equal(t, true, payload["success"], raw)
	result := payload["data"].(map[string]any)
	assert.Equal(t, []any{float64(enabledId)}, result["succeeded"])
	failed := result["failed"].([]any)
	require.Len(t, failed, 1)
	assert.Equal(t, float64(autoDisabledId), failed[0].(map[string]any)["id"])
	assert.Contains(t, failed[0].(map[string]any)["message"], "disabled automatically")

	payload, raw = callUserChannelAPI(t, 11, BatchUserChannels, http.MethodPost, "/api/user/channel-batch",
		fmt.Sprintf(`{"action":"delete","ids":[%d,%d]}`, enabledId, autoDisabledId))
	require.Equal(t, true, payload["success"], raw)
	result = payload["data"].(map[string]any)
	assert.Len(t, result["succeeded"], 2)
	_, err := model.GetChannelForOwner(enabledId, 11)
	assert.ErrorIs(t, err, model.ErrChannelNotFound)
	_, err = model.GetChannelForOwner(autoDisabledId, 11)
	assert.ErrorIs(t, err, model.ErrChannelNotFound)
}

func TestUserChannelOptionsIncludeLiveProviderPlugins(t *testing.T) {
	setupTaskPluginBindChannelTest(t)
	const pluginKey = "seller-options-live"
	source := fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: "Seller options live",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["live-model"],
  baseUrl: "https://93.184.216.34",
  relay: [{incoming_path: "/v1/chat/completions", upstream_path: "/chat"}]
};
`, pluginKey)
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(pluginKey) })

	payload, raw := callUserChannelAPI(t, 11, GetUserChannelOptions, http.MethodGet, "/api/user/channel_options", "")
	require.Equal(t, true, payload["success"], raw)
	data := payload["data"].(map[string]any)

	types := data["types"].([]any)
	require.NotEmpty(t, types)
	openAI := types[0].(map[string]any)
	assert.Equal(t, float64(constant.ChannelTypeOpenAI), openAI["type"])
	assert.NotEmpty(t, openAI["models"])

	plugins := data["plugins"].([]any)
	var plugin map[string]any
	for _, item := range plugins {
		candidate := item.(map[string]any)
		if candidate["key"] == pluginKey {
			plugin = candidate
			break
		}
	}
	require.NotNil(t, plugin)
	assert.Equal(t, "Seller options live", plugin["name"])
	assert.Equal(t, []any{"live-model"}, plugin["models"])
	assert.Equal(t, "https://93.184.216.34", plugin["baseUrl"])
}

func TestUserChannelPluginLoginStaysOwnerScoped(t *testing.T) {
	setupTaskPluginBindChannelTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.AuthFlow{}))
	service.InitHttpClient()
	const pluginKey = "seller-login-live"
	source := fmt.Sprintf(`
export const meta = {
  apiVersion: 1,
  key: %q,
  name: "Seller login live",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["login-model"],
  baseUrl: "https://93.184.216.34",
  relay: [{incoming_path: "/v1/chat/completions", upstream_path: "/chat"}],
  channelConfig: {
    type: "object",
    properties: {
      workspace: {type: "string", title: "Workspace"}
    }
  }
};
export function login(ctx, input) {
  if (input === null) {
    return {
      type: "fields",
      fields: [{name: "token", label: "Token", type: "password", required: true}]
    };
  }
  return {type: "done", credential: {token: input.fields.token}};
}
`, pluginKey)
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { _ = jsplugin.DefaultRegistry.Unregister(pluginKey) })

	payload, raw := callUserChannelAPI(t, 11, CreateUserChannel, http.MethodPost, "/api/user/channels", fmt.Sprintf(`{
		"name": "seller-login",
		"type": %d,
		"key": "",
		"base_url": "https://93.184.216.34",
		"models": ["login-model"],
		"task_plugin_key": %q,
		"plugin_config": {"workspace": "team-a"}
	}`, constant.ChannelTypeTaskPlugin, pluginKey))
	require.Equal(t, true, payload["success"], raw)
	data := payload["data"].(map[string]any)
	channelID := int(data["id"].(float64))
	assert.Equal(t, pluginKey, data["task_plugin_key"])
	assert.Equal(t, map[string]any{"workspace": "team-a"}, data["plugin_config"])
	assert.Equal(t, float64(common.ChannelStatusAutoDisabled), data["status"])

	stored, err := model.GetChannelById(channelID, true)
	require.NoError(t, err)
	assert.Empty(t, stored.Key)
	assert.Equal(t, pluginKey, stored.GetSetting().TaskPluginKey)
	assert.JSONEq(t, `{"workspace":"team-a"}`, string(stored.GetOtherSettings().PluginConfig))
	assert.Equal(t, model.ChannelStatusReasonPluginLoginRequired, stored.GetOtherInfo()["status_reason"])

	payload, raw = callUserChannelAPI(t, 11, StartUserPluginLogin, http.MethodPost,
		fmt.Sprintf("/api/user/channels/%d/plugin_login", channelID), `{"key_index":null}`, channelIDParam(channelID))
	require.Equal(t, true, payload["success"], raw)
	step := payload["data"].(map[string]any)["step"].(map[string]any)
	assert.Equal(t, "fields", step["type"])

	payload, raw = callUserChannelAPI(t, 12, StartUserPluginLogin, http.MethodPost,
		fmt.Sprintf("/api/user/channels/%d/plugin_login", channelID), `{"key_index":null}`, channelIDParam(channelID))
	assert.Equal(t, false, payload["success"], raw)
	assert.NotContains(t, raw, pluginKey)

	payload, raw = callUserChannelAPI(t, 12, GetUserPluginCredentials, http.MethodGet,
		fmt.Sprintf("/api/user/channels/%d/plugin_credentials", channelID), "", channelIDParam(channelID))
	assert.Equal(t, false, payload["success"], raw)

	payload, raw = callUserChannelAPI(t, 11, GetUserPluginCredentials, http.MethodGet,
		fmt.Sprintf("/api/user/channels/%d/plugin_credentials", channelID), "", channelIDParam(channelID))
	require.Equal(t, true, payload["success"], raw)
}
