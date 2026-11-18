package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/vertex"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

const userChannelMaxModels = 500

func userChannelResponse(channel *model.Channel, boundPackages []string) dto.UserChannelResponse {
	response := dto.UserChannelResponse{
		ID:            channel.Id,
		Name:          channel.Name,
		Type:          channel.Type,
		BaseURL:       channel.GetBaseURL(),
		Models:        channel.GetModels(),
		ModelMapping:  channel.GetModelMapping(),
		TestModel:     channel.GetTestModel(),
		Other:         channel.Other,
		Priority:      channel.GetPriority(),
		Weight:        channel.GetWeight(),
		Status:        channel.Status,
		CreatedTime:   channel.CreatedTime,
		BoundPackages: boundPackages,
	}
	return response
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
	channel.Setting = nil
	// An empty base URL means the provider default endpoint, which the platform
	// owns; only seller-supplied hosts go through the untrusted-target policy.
	if channel.BaseURL != nil {
		if err := service.ValidateUserChannelBaseURL(*channel.BaseURL); err != nil {
			return common.NewMessage("Base URL is not allowed: {{error}}", map[string]any{"error": err.Error()})
		}
	}
	// Vertex builds its upstream host from the region in Other, so the region
	// is held to plain location ids like the base URL is held to public hosts.
	if channel.Type == constant.ChannelTypeVertexAi && !vertex.IsValidVertexRegionConfig(channel.Other) {
		return common.NewMessage("The Vertex region is not valid")
	}
	return validateChannel(channel, isAdd)
}

func GetUserChannels(c *gin.Context) {
	userId := c.GetInt("id")
	channels, err := model.ListChannelsByOwner(userId, c.Query("keyword"))
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
	common.ApiSuccess(c, responses)
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
	if key == "" {
		common.ApiError(c, common.NewMessage("Channel key is required"))
		return
	}
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

	bound, err := model.IsChannelBoundToActivePackage(channelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if bound {
		// Other carries the Vertex region, which chooses the upstream host.
		locked := stored.GetBaseURL() != updated.GetBaseURL() ||
			stored.GetModelMapping() != updated.GetModelMapping() ||
			stored.Models != updated.Models ||
			stored.Other != updated.Other
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
	// Ownership comes first, so the bound check never tells a seller anything
	// about someone else's channel.
	if _, err := model.GetChannelForOwner(channelId, userId); err != nil {
		common.ApiError(c, err)
		return
	}
	bound, err := model.IsChannelBoundToActivePackage(channelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if bound {
		common.ApiError(c, common.NewMessage("A channel bound to a listed package cannot be deleted. Submit a new package version without this channel first."))
		return
	}
	if err := model.DeleteUserChannel(channelId, userId); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
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
		if key == "" {
			// The stored key only ever goes to the stored endpoint: a preview
			// against another base URL must bring its own key, so the key
			// cannot be read back by pointing the request at a chosen host.
			if baseURL != stored.GetBaseURL() {
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
	models, err := fetchChannelUpstreamModelIDs(preview)
	if err != nil {
		common.ApiErrorT(c, "Failed to fetch models: {{error}}", map[string]any{"error": sanitizeFetchModelsError(err, key).Error()})
		return
	}
	common.ApiSuccess(c, models)
}
