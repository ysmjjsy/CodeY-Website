package controller

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relay/channel/vertex"
	relaydto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

const userChannelMaxModels = 500

type userChannelTypeOption struct {
	Type   int      `json:"type"`
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

func userChannelPluginOptions() []gin.H {
	options := taskPluginOptions()
	filtered := make([]gin.H, 0, len(options))
	for _, option := range options {
		taskPart, _ := option["task"].(bool)
		providerPart, _ := option["provider"].(bool)
		if !taskPart && !providerPart {
			continue
		}
		for _, key := range []string{
			"configSchema", "samples", "usageSchema", "usageProfiles",
		} {
			delete(option, key)
		}
		// Seller pages cannot read the administrator-only plugin icon route.
		option["hasIcon"] = false
		filtered = append(filtered, option)
	}
	return filtered
}

// GetUserChannelOptions returns the built-in types an administrator enabled
// for the marketplace and the provider plugins the seller channel form may
// bind. Plugin availability follows the live registry, not a saved type list.
func GetUserChannelOptions(c *gin.Context) {
	allowed := token_package_setting.GetTokenPackageSetting().AllowedChannelTypes
	allowed = slices.DeleteFunc(slices.Clone(allowed), func(channelType int) bool {
		return !token_package_setting.IsChannelTypeAllowed(channelType)
	})

	types := make([]userChannelTypeOption, 0, len(allowed))
	for _, channelType := range token_package_setting.PermittableChannelTypes() {
		models := append([]string{}, channelId2Models[channelType]...)
		types = append(types, userChannelTypeOption{
			Type:   channelType,
			Name:   constant.GetChannelTypeName(channelType),
			Models: models,
		})
	}

	common.ApiSuccess(c, gin.H{
		"allowed_channel_types": allowed,
		"types":                 types,
		"plugins":               userChannelPluginOptions(),
	})
}

func userChannelResponse(channel *model.Channel, boundPackages []string) dto.UserChannelResponse {
	openAIOrganization := ""
	if channel.OpenAIOrganization != nil {
		openAIOrganization = *channel.OpenAIOrganization
	}
	response := dto.UserChannelResponse{
		ID:                 channel.Id,
		Name:               channel.Name,
		Type:               channel.Type,
		BaseURL:            channel.GetBaseURL(),
		OpenAIOrganization: openAIOrganization,
		Models:             channel.GetModels(),
		ModelMapping:       channel.GetModelMapping(),
		TestModel:          channel.GetTestModel(),
		Other:              channel.Other,
		Priority:           channel.GetPriority(),
		Weight:             channel.GetWeight(),
		Status:             channel.Status,
		Settings:           userChannelSettingsResponse(channel),
		TaskPluginKey:      channel.GetSetting().TaskPluginKey,
		PluginConfig:       channel.GetOtherSettings().PluginConfig,
		CreatedTime:        channel.CreatedTime,
		BoundPackages:      boundPackages,
	}
	return response
}

func userChannelSettingsResponse(channel *model.Channel) *dto.UserChannelSettings {
	settings := channel.GetOtherSettings()
	response := &dto.UserChannelSettings{}
	hasValue := false

	if settings.AzureResponsesVersion != "" {
		value := settings.AzureResponsesVersion
		response.AzureResponsesVersion = &value
		hasValue = true
	}
	if settings.VertexKeyType != "" {
		value := string(settings.VertexKeyType)
		response.VertexKeyType = &value
		hasValue = true
	}
	if settings.VertexProjectID != "" {
		value := settings.VertexProjectID
		response.VertexProjectID = &value
		hasValue = true
	}
	if settings.VertexAPIVersion != "" {
		value := settings.VertexAPIVersion
		response.VertexAPIVersion = &value
		hasValue = true
	}
	if settings.OpenRouterEnterprise != nil {
		response.OpenRouterEnterprise = settings.OpenRouterEnterprise
		hasValue = true
	}
	if settings.AwsKeyType != "" {
		value := string(settings.AwsKeyType)
		response.AwsKeyType = &value
		hasValue = true
	}
	if settings.AwsApiType != "" {
		value := string(settings.AwsApiType)
		response.AwsApiType = &value
		hasValue = true
	}

	if !hasValue {
		return nil
	}
	return response
}

func applyUserChannelSettings(channel *model.Channel, patch *dto.UserChannelSettings) error {
	if patch == nil {
		return nil
	}

	switch channel.Type {
	case constant.ChannelTypeAzure,
		constant.ChannelTypeOpenRouter,
		constant.ChannelTypeAws,
		constant.ChannelTypeVertexAi:
	default:
		return nil
	}

	settings := channel.GetOtherSettings()
	switch channel.Type {
	case constant.ChannelTypeAzure:
		if patch.AzureResponsesVersion != nil {
			settings.AzureResponsesVersion = strings.TrimSpace(*patch.AzureResponsesVersion)
		}
	case constant.ChannelTypeOpenRouter:
		if patch.OpenRouterEnterprise != nil {
			settings.OpenRouterEnterprise = patch.OpenRouterEnterprise
		}
	case constant.ChannelTypeAws:
		if patch.AwsKeyType != nil {
			keyType := strings.TrimSpace(*patch.AwsKeyType)
			if keyType != "" && keyType != string(relaydto.AwsKeyTypeAKSK) && keyType != string(relaydto.AwsKeyTypeApiKey) {
				return common.NewMessage("Invalid AWS key format")
			}
			settings.AwsKeyType = relaydto.AwsKeyType(keyType)
		}
		if patch.AwsApiType != nil {
			apiType := strings.TrimSpace(*patch.AwsApiType)
			if apiType != "" && apiType != string(relaydto.AwsApiTypeInvokeModel) && apiType != string(relaydto.AwsApiTypeMantle) {
				return common.NewMessage("Invalid AWS API type")
			}
			settings.AwsApiType = relaydto.AwsApiType(apiType)
		}
	case constant.ChannelTypeVertexAi:
		if patch.VertexKeyType != nil {
			keyType := strings.TrimSpace(*patch.VertexKeyType)
			if keyType != "" && keyType != string(relaydto.VertexKeyTypeJSON) && keyType != string(relaydto.VertexKeyTypeAPIKey) {
				return common.NewMessage("Invalid Vertex AI key format")
			}
			settings.VertexKeyType = relaydto.VertexKeyType(keyType)
		}
		if patch.VertexAPIVersion != nil {
			apiVersion := strings.TrimSpace(*patch.VertexAPIVersion)
			if apiVersion != "" && apiVersion != "v1" && apiVersion != "v1beta1" {
				return common.NewMessage("Invalid Vertex AI API version")
			}
			settings.VertexAPIVersion = apiVersion
		}
		if patch.VertexProjectID != nil {
			settings.VertexProjectID = strings.TrimSpace(*patch.VertexProjectID)
		}
		if settings.VertexKeyType != relaydto.VertexKeyTypeAPIKey {
			settings.VertexProjectID = ""
		}
	}
	channel.SetOtherSettings(settings)
	return nil
}

func applyUserChannelPluginBinding(channel *model.Channel, taskPluginKey *string, pluginConfig json.RawMessage) {
	if channel.Type != constant.ChannelTypeTaskPlugin {
		return
	}
	if taskPluginKey != nil {
		setting := channel.GetSetting()
		setting.TaskPluginKey = strings.TrimSpace(*taskPluginKey)
		channel.SetSetting(setting)
	}
	if pluginConfig != nil {
		settings := channel.GetOtherSettings()
		settings.PluginConfig = pluginConfig
		channel.SetOtherSettings(settings)
	}
}

func pluginConfigEquivalent(first, second json.RawMessage) bool {
	normalize := func(value json.RawMessage) string {
		trimmed := strings.TrimSpace(string(value))
		if trimmed == "" || trimmed == "null" || trimmed == "{}" {
			return ""
		}
		return trimmed
	}
	return normalize(first) == normalize(second)
}

func userChannelSettingsEquivalent(first, second *model.Channel) bool {
	firstSettings := first.GetOtherSettings()
	secondSettings := second.GetOtherSettings()
	firstChannelSettings := first.GetSetting()
	secondChannelSettings := second.GetSetting()

	vertexKeyType := func(value relaydto.VertexKeyType) relaydto.VertexKeyType {
		if value == "" {
			return relaydto.VertexKeyTypeJSON
		}
		return value
	}
	vertexAPIVersion := func(value string) string {
		if value == "" {
			return "v1"
		}
		return value
	}
	awsKeyType := func(value relaydto.AwsKeyType) relaydto.AwsKeyType {
		if value == "" {
			return relaydto.AwsKeyTypeAKSK
		}
		return value
	}
	awsAPIType := func(value relaydto.AwsApiType) relaydto.AwsApiType {
		if value == "" {
			return relaydto.AwsApiTypeInvokeModel
		}
		return value
	}
	openRouterEnterprise := func(value *bool) bool {
		return value != nil && *value
	}

	return firstSettings.AzureResponsesVersion == secondSettings.AzureResponsesVersion &&
		vertexKeyType(firstSettings.VertexKeyType) == vertexKeyType(secondSettings.VertexKeyType) &&
		firstSettings.VertexProjectID == secondSettings.VertexProjectID &&
		vertexAPIVersion(firstSettings.VertexAPIVersion) == vertexAPIVersion(secondSettings.VertexAPIVersion) &&
		openRouterEnterprise(firstSettings.OpenRouterEnterprise) == openRouterEnterprise(secondSettings.OpenRouterEnterprise) &&
		awsKeyType(firstSettings.AwsKeyType) == awsKeyType(secondSettings.AwsKeyType) &&
		awsAPIType(firstSettings.AwsApiType) == awsAPIType(secondSettings.AwsApiType) &&
		firstChannelSettings.TaskPluginKey == secondChannelSettings.TaskPluginKey &&
		pluginConfigEquivalent(firstSettings.PluginConfig, secondSettings.PluginConfig)
}

// normalizeUserChannelModels trims, de-duplicates, and bounds the model list a
// seller submits.
func normalizeUserChannelModels(models []string) ([]string, error) {
	seen := make(map[string]struct{}, len(models))
	normalized := make([]string, 0, len(models))
	for _, modelName := range models {
		trimmed := strings.TrimSpace(modelName)
		if trimmed == "" {
			continue
		}
		if len(trimmed) > 255 {
			return nil, common.NewMessage("Model name is too long: {{model}}", map[string]any{"model": trimmed})
		}
		if _, duplicate := seen[trimmed]; duplicate {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	if len(normalized) == 0 {
		return nil, common.NewMessage("At least one model is required")
	}
	if len(normalized) > userChannelMaxModels {
		return nil, common.NewMessage("A channel cannot serve more than {{count}} models", map[string]any{"count": userChannelMaxModels})
	}
	return normalized, nil
}

func userChannelModelMappingJSON(mapping map[string]string) (*string, error) {
	if len(mapping) == 0 {
		empty := "{}"
		return &empty, nil
	}
	if len(mapping) > 200 {
		return nil, common.NewMessage("Model mapping cannot contain more than {{count}} entries", map[string]any{"count": 200})
	}
	cleaned := make(map[string]string, len(mapping))
	for from, to := range mapping {
		from = strings.TrimSpace(from)
		to = strings.TrimSpace(to)
		if from == "" || to == "" {
			return nil, common.NewMessage("Model mapping entries cannot be empty")
		}
		cleaned[from] = to
	}
	encoded, err := common.Marshal(cleaned)
	if err != nil {
		return nil, err
	}
	text := string(encoded)
	return &text, nil
}

// validateUserChannelPayload applies the marketplace rules that sit above the
// shared channel validation: allowed type, public base URL, bounded fields.
func validateUserChannelPayload(channel *model.Channel, isAdd bool) error {
	if !token_package_setting.IsChannelTypeAllowed(channel.Type) {
		return common.NewMessage("Channel type {{type}} is not allowed for marketplace channels", map[string]any{"type": channel.Type})
	}
	channel.Group = ""
	channel.Tag = nil
	channel.ParamOverride = nil
	channel.HeaderOverride = nil
	channel.StatusCodeMapping = nil
	channelSetting := channel.GetSetting()
	if channel.Type == constant.ChannelTypeTaskPlugin {
		channel.SetSetting(relaydto.ChannelSettings{TaskPluginKey: strings.TrimSpace(channelSetting.TaskPluginKey)})
	} else {
		channel.Setting = nil
	}
	otherSettings := channel.GetOtherSettings()
	if channel.Type == constant.ChannelTypeTaskPlugin {
		channel.SetOtherSettings(relaydto.ChannelOtherSettings{PluginConfig: otherSettings.PluginConfig})
	} else if otherSettings.PluginConfig != nil {
		otherSettings.PluginConfig = nil
		channel.SetOtherSettings(otherSettings)
	}
	// An empty base URL means the provider default endpoint, which the platform
	// owns; only seller-supplied hosts go through the untrusted-target policy.
	// Vertex builds its upstream host from the region in Other, so the region
	// is held to plain location ids like the base URL is held to public hosts.
	if channel.Type == constant.ChannelTypeVertexAi && !vertex.IsValidVertexRegionConfig(channel.Other) {
		return common.NewMessage("The Vertex region is not valid")
	}
	if err := validateChannel(channel, isAdd); err != nil {
		return err
	}
	// Plugin channels may inherit their endpoint from the plugin, so validate
	// the final value rather than only the URL the seller submitted.
	if channel.BaseURL != nil {
		if err := service.ValidateUserChannelBaseURL(*channel.BaseURL); err != nil {
			return common.NewMessage("Base URL is not allowed: {{error}}", map[string]any{"error": err.Error()})
		}
	}
	return nil
}

func GetUserChannels(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	typeFilter, _ := strconv.Atoi(c.Query("type"))
	channels, total, err := model.ListChannelsByOwner(userId, model.UserChannelListFilter{
		Keyword:  c.Query("keyword"),
		Status:   c.Query("status"),
		Type:     typeFilter,
		Bound:    c.Query("bound"),
		Page:     pageInfo.GetPage(),
		PageSize: pageInfo.GetPageSize(),
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channelIds := make([]int, 0, len(channels))
	for _, channel := range channels {
		channelIds = append(channelIds, channel.Id)
	}
	boundPackages, err := model.ListPackageTitlesBoundToChannels(channelIds)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	responses := make([]dto.UserChannelResponse, 0, len(channels))
	for _, channel := range channels {
		responses = append(responses, userChannelResponse(channel, boundPackages[channel.Id]))
	}
	common.ApiSuccess(c, gin.H{
		"items":     responses,
		"total":     total,
		"page":      pageInfo.GetPage(),
		"page_size": pageInfo.GetPageSize(),
	})
}

func GetUserChannel(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelForOwner(channelId, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	boundPackages, err := model.ListPackageTitlesBoundToChannels([]int{channel.Id})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, userChannelResponse(channel, boundPackages[channel.Id]))
}

func CreateUserChannel(c *gin.Context) {
	userId := c.GetInt("id")
	request := dto.CreateUserChannelRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}

	name := strings.TrimSpace(request.Name)
	if name == "" {
		common.ApiError(c, common.NewMessage("Channel name is required"))
		return
	}
	key := strings.TrimSpace(request.Key)
	models, err := normalizeUserChannelModels(request.Models)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	mapping, err := userChannelModelMappingJSON(request.ModelMapping)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	baseURL := strings.TrimSpace(request.BaseURL)
	testModel := strings.TrimSpace(request.TestModel)

	channel := &model.Channel{
		Type:         request.Type,
		Key:          key,
		Name:         name,
		Models:       strings.Join(models, ","),
		Group:        "",
		BaseURL:      &baseURL,
		ModelMapping: mapping,
		TestModel:    &testModel,
		Other:        request.Other,
		Priority:     request.Priority,
		Weight:       request.Weight,
		Status:       common.ChannelStatusEnabled,
		CreatedTime:  common.GetTimestamp(),
		OwnerUserId:  userId,
	}
	if request.OpenAIOrganization != nil {
		organization := strings.TrimSpace(*request.OpenAIOrganization)
		if organization != "" {
			channel.OpenAIOrganization = common.GetPointer(organization)
		}
	}
	if err := applyUserChannelSettings(channel, request.Settings); err != nil {
		common.ApiError(c, err)
		return
	}
	applyUserChannelPluginBinding(channel, request.TaskPluginKey, request.PluginConfig)
	if key == "" && !service.ChannelSupportsPluginLogin(channel) {
		common.ApiError(c, common.NewMessage("Channel key is required"))
		return
	}
	if key == "" {
		// A keyless login plugin waits for its first credential, just like a
		// channel created from the administrator page.
		service.PluginLoginNeededStatus(channel)
	}
	if err := validateUserChannelPayload(channel, true); err != nil {
		common.ApiError(c, err)
		return
	}
	if err := channel.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, userChannelResponse(channel, nil))
}

func UpdateUserChannel(c *gin.Context) {
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stored, err := model.GetChannelForOwner(channelId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	request := dto.UpdateUserChannelRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}

	updated := *stored
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" {
			common.ApiError(c, common.NewMessage("Channel name is required"))
			return
		}
		updated.Name = name
	}
	if request.BaseURL != nil {
		baseURL := strings.TrimSpace(*request.BaseURL)
		updated.BaseURL = &baseURL
	}
	if request.OpenAIOrganization != nil {
		organization := strings.TrimSpace(*request.OpenAIOrganization)
		updated.OpenAIOrganization = common.GetPointer(organization)
	}
	if request.Models != nil {
		models, err := normalizeUserChannelModels(*request.Models)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		updated.Models = strings.Join(models, ",")
	}
	if request.ModelMapping != nil {
		mapping, err := userChannelModelMappingJSON(*request.ModelMapping)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		updated.ModelMapping = mapping
	}
	if request.TestModel != nil {
		testModel := strings.TrimSpace(*request.TestModel)
		updated.TestModel = &testModel
	}
	if request.Other != nil {
		updated.Other = strings.TrimSpace(*request.Other)
	}
	if request.Priority != nil {
		updated.Priority = request.Priority
	}
	if request.Weight != nil {
		updated.Weight = request.Weight
	}
	if err := applyUserChannelSettings(&updated, request.Settings); err != nil {
		common.ApiError(c, err)
		return
	}
	applyUserChannelPluginBinding(&updated, request.TaskPluginKey, request.PluginConfig)

	bound, err := model.IsChannelBoundToActivePackage(channelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if bound {
		// Other carries the Vertex region, which chooses the upstream host.
		storedOrganization := ""
		if stored.OpenAIOrganization != nil {
			storedOrganization = *stored.OpenAIOrganization
		}
		updatedOrganization := ""
		if updated.OpenAIOrganization != nil {
			updatedOrganization = *updated.OpenAIOrganization
		}
		locked := stored.GetBaseURL() != updated.GetBaseURL() ||
			storedOrganization != updatedOrganization ||
			stored.GetModelMapping() != updated.GetModelMapping() ||
			stored.Models != updated.Models ||
			stored.Other != updated.Other ||
			!userChannelSettingsEquivalent(stored, &updated)
		if locked {
			common.ApiError(c, common.NewMessage("A channel bound to a listed package cannot change its endpoint, models, or model mapping. Submit a new package version without this channel first."))
			return
		}
	}

	key := ""
	if request.Key != nil {
		key = strings.TrimSpace(*request.Key)
		if key == "" {
			common.ApiError(c, common.NewMessage("Channel key cannot be empty"))
			return
		}
		// Validation of key-shaped credentials needs the new key in place.
		updated.Key = key
	}
	if err := validateUserChannelPayload(&updated, false); err != nil {
		common.ApiError(c, err)
		return
	}
	// Reject an invalid status before anything is saved, so a failed update
	// never leaves part of its changes behind.
	if request.Status != nil && *request.Status != common.ChannelStatusEnabled && *request.Status != common.ChannelStatusManuallyDisabled {
		common.ApiError(c, common.NewMessage("Invalid channel status"))
		return
	}
	// Buyers are routed to a bound channel right away, so a new key must work
	// before it replaces the old one.
	if bound && key != "" {
		probe := updated
		result := testChannel(c.Request.Context(), &probe, userId, "", "", false)
		if result.localErr != nil || result.newAPIError != nil {
			reason := ""
			if result.localErr != nil {
				reason = result.localErr.Error()
			} else {
				reason = result.newAPIError.Error()
			}
			common.ApiError(c, common.NewMessage("The new key failed the connection test: {{error}}", map[string]any{"error": sanitizeFetchModelsError(errors.New(reason), key).Error()}))
			return
		}
	}
	if err := updated.Update(); err != nil {
		common.ApiError(c, err)
		return
	}
	if key != "" {
		if err := model.UpdateUserChannelKey(channelId, userId, key); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if request.Status != nil {
		status := *request.Status
		if err := model.SetUserChannelStatus(channelId, userId, status); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	channel, err := model.GetChannelForOwner(channelId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	boundPackages, err := model.ListPackageTitlesBoundToChannels([]int{channel.Id})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, userChannelResponse(channel, boundPackages[channel.Id]))
}

func DeleteUserChannel(c *gin.Context) {
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := deleteOwnedUserChannel(channelId, userId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func deleteOwnedUserChannel(channelId int, userId int) error {
	// Ownership comes first, so the bound check never tells a seller anything
	// about someone else's channel.
	if _, err := model.GetChannelForOwner(channelId, userId); err != nil {
		return err
	}
	bound, err := model.IsChannelBoundToActivePackage(channelId)
	if err != nil {
		return err
	}
	if bound {
		return common.NewMessage("A channel bound to a listed package cannot be deleted. Submit a new package version without this channel first.")
	}
	return model.DeleteUserChannel(channelId, userId)
}

const userChannelBatchLimit = 100

func BatchUserChannels(c *gin.Context) {
	userId := c.GetInt("id")
	request := dto.BatchUserChannelRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	action := strings.ToLower(strings.TrimSpace(request.Action))
	if action != "enable" && action != "disable" && action != "delete" {
		common.ApiError(c, common.NewMessage("Invalid channel batch action"))
		return
	}
	seen := make(map[int]struct{}, len(request.IDs))
	ids := make([]int, 0, len(request.IDs))
	for _, id := range request.IDs {
		if id <= 0 {
			continue
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		common.ApiError(c, common.NewMessage("Select at least one channel"))
		return
	}
	if len(ids) > userChannelBatchLimit {
		common.ApiError(c, common.NewMessage("A batch operation can include at most {{count}} channels", map[string]any{"count": userChannelBatchLimit}))
		return
	}

	result := dto.BatchUserChannelResponse{
		Succeeded: make([]int, 0, len(ids)),
		Failed:    make([]dto.BatchUserChannelFailure, 0),
	}
	for _, id := range ids {
		channel, err := model.GetChannelForOwner(id, userId)
		if err != nil {
			message := err.Error()
			if errors.Is(err, model.ErrChannelNotFound) {
				message = "Channel not found"
			}
			result.Failed = append(result.Failed, dto.BatchUserChannelFailure{
				ID:      id,
				Message: message,
			})
			continue
		}

		switch action {
		case "enable":
			if channel.Status == common.ChannelStatusEnabled {
				result.Succeeded = append(result.Succeeded, id)
				continue
			}
			err = model.SetUserChannelStatus(id, userId, common.ChannelStatusEnabled)
		case "disable":
			if channel.Status != common.ChannelStatusEnabled {
				result.Succeeded = append(result.Succeeded, id)
				continue
			}
			err = model.SetUserChannelStatus(id, userId, common.ChannelStatusManuallyDisabled)
		case "delete":
			err = deleteOwnedUserChannel(id, userId)
		}
		if err != nil {
			result.Failed = append(result.Failed, dto.BatchUserChannelFailure{
				ID:      id,
				Name:    channel.Name,
				Message: err.Error(),
			})
			continue
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	common.ApiSuccess(c, result)
}

func TestUserChannel(c *gin.Context) {
	userId := c.GetInt("id")
	channelId, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelById(channelId, true)
	if err != nil || channel.OwnerUserId != userId {
		common.ApiError(c, model.ErrChannelNotFound)
		return
	}
	if !token_package_setting.IsChannelTypeAllowed(channel.Type) {
		common.ApiError(c, common.NewMessage("Channel type {{type}} is not allowed for marketplace channels", map[string]any{"type": channel.Type}))
		return
	}
	testModel := strings.TrimSpace(c.Query("model"))
	endpointType := c.Query("endpoint_type")
	isStream, _ := strconv.ParseBool(c.Query("stream"))

	requestCtx := c.Request.Context()
	started := time.Now()
	result := testChannel(requestCtx, channel, userId, testModel, endpointType, isStream)
	elapsed := time.Since(started)
	if result.localErr != nil {
		response := gin.H{"success": false, "message": result.localErr.Error()}
		if result.newAPIError != nil {
			response["error_code"] = result.newAPIError.GetErrorCode()
		}
		c.JSON(http.StatusOK, response)
		return
	}
	if result.newAPIError != nil {
		c.JSON(http.StatusOK, gin.H{
			"success":    false,
			"message":    result.newAPIError.Error(),
			"error_code": result.newAPIError.GetErrorCode(),
			"time":       elapsed.Seconds(),
		})
		return
	}
	go channel.UpdateResponseTime(elapsed.Milliseconds())
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "time": elapsed.Seconds()})
}

// FetchUserChannelModels previews the model list of a seller upstream before
// the channel is saved. The request always runs through the untrusted client.
func FetchUserChannelModels(c *gin.Context) {
	userId := c.GetInt("id")
	request := dto.FetchUserChannelModelsRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	channelType := 0
	baseURL := strings.TrimSpace(request.BaseURL)
	key := strings.TrimSpace(request.Key)
	pluginKey := strings.TrimSpace(request.TaskPluginKey)
	pluginConfig := request.PluginConfig

	if channelId > 0 {
		stored, err := model.GetChannelById(channelId, true)
		if err != nil || stored.OwnerUserId != userId {
			common.ApiError(c, model.ErrChannelNotFound)
			return
		}
		channelType = stored.Type
		if baseURL == "" {
			baseURL = stored.GetBaseURL()
		}
		storedPluginKey := strings.TrimSpace(stored.GetSetting().TaskPluginKey)
		storedPluginConfig := stored.GetOtherSettings().PluginConfig
		if channelType == constant.ChannelTypeTaskPlugin {
			if pluginKey == "" {
				pluginKey = storedPluginKey
			}
			if pluginConfig == nil {
				pluginConfig = storedPluginConfig
			}
		}
		if key == "" {
			// The stored key only ever goes to the stored endpoint: a preview
			// against another base URL must bring its own key, so the key
			// cannot be read back by pointing the request at a chosen host.
			if baseURL != stored.GetBaseURL() ||
				pluginKey != storedPluginKey ||
				!pluginConfigEquivalent(pluginConfig, storedPluginConfig) {
				common.ApiError(c, common.NewMessage("Enter the key to fetch models from a different base URL"))
				return
			}
			key = stored.Key
		}
	} else {
		typeParam, err := strconv.Atoi(c.Query("type"))
		if err != nil {
			common.ApiError(c, common.NewMessage("Channel type is required"))
			return
		}
		channelType = typeParam
	}
	if !token_package_setting.IsChannelTypeAllowed(channelType) {
		common.ApiError(c, common.NewMessage("Channel type {{type}} is not allowed for marketplace channels", map[string]any{"type": channelType}))
		return
	}
	if key == "" {
		common.ApiError(c, common.NewMessage("Channel key is required"))
		return
	}
	if channelType == constant.ChannelTypeTaskPlugin {
		if pluginKey == "" {
			common.ApiError(c, common.NewMessage("Plugin is required"))
			return
		}
		plugin, ok := jsplugin.DefaultRegistry.Get(pluginKey)
		if !ok {
			common.ApiError(c, common.NewMessage("Plugin {{plugin}} is not registered", map[string]any{"plugin": pluginKey}))
			return
		}
		if baseURL == "" {
			baseURL = strings.TrimSpace(plugin.Meta.BaseURL)
		}
		if baseURL == "" {
			common.ApiError(c, common.NewMessage("Base URL is required for this channel type"))
			return
		}
	}
	if err := service.ValidateUserChannelBaseURL(baseURL); err != nil {
		common.ApiError(c, common.NewMessage("Base URL is not allowed: {{error}}", map[string]any{"error": err.Error()}))
		return
	}

	preview := &model.Channel{
		Type:        channelType,
		Key:         key,
		BaseURL:     &baseURL,
		OwnerUserId: userId,
	}
	if channelType == constant.ChannelTypeTaskPlugin {
		preview.SetSetting(relaydto.ChannelSettings{TaskPluginKey: pluginKey})
		preview.SetOtherSettings(relaydto.ChannelOtherSettings{PluginConfig: pluginConfig})
	}
	models, err := fetchChannelUpstreamModelIDs(preview)
	if err != nil {
		common.ApiErrorT(c, "Failed to fetch models: {{error}}", map[string]any{"error": sanitizeFetchModelsError(err, key).Error()})
		return
	}
	common.ApiSuccess(c, models)
}
