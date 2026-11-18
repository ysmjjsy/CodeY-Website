package controller

import (
	"errors"
	"io"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type pluginLoginStartRequest struct {
	KeyIndex *int `json:"key_index"`
	Add      bool `json:"add"`
}

type pluginLoginContinueRequest struct {
	Flow  string                   `json:"flow"`
	Input service.PluginLoginInput `json:"input"`
}

type pluginLoginCallbackRequest struct {
	Plugin string            `json:"plugin"`
	Params map[string]string `json:"params"`
}

// pluginLoginIdentity is the session a login flow belongs to: a browser
// session, or a scoped access token with its own session. ownerScoped limits
// the flow to a channel owned by the caller.
func pluginLoginIdentity(c *gin.Context, ownerScoped bool) (service.PluginLoginIdentity, bool) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return service.PluginLoginIdentity{}, false
	}
	loginIdentity := service.PluginLoginIdentity{UserID: identity.UserID, SessionID: identity.SessionID}
	if ownerScoped {
		loginIdentity.OwnerUserID = c.GetInt("id")
	}
	return loginIdentity, true
}

func pluginLoginChannelID(c *gin.Context) (int, bool) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		common.ApiErrorT(c, "Channel does not exist")
		return 0, false
	}
	return channelID, true
}

// finishPluginLogin answers a login call; a done step stored a credential, so
// the channel cache is reloaded. Administrator logins keep their audit entry;
// seller logins are ordinary owner operations.
func finishPluginLogin(c *gin.Context, result service.PluginLoginResult, data gin.H) {
	if credential := result.Step.Credential; credential != nil {
		model.InitChannelCache()
		if c.GetInt("role") >= common.RoleAdminUser {
			recordManageAudit(c, "channel.update", map[string]any{
				"id":             result.ChannelID,
				"name":           result.ChannelName,
				"changed_fields": []string{"key"},
				"source":         "plugin_login",
				"label":          credential.Label,
				"account_id":     credential.AccountID,
			})
		}
	}
	data["step"] = result.Step
	common.ApiSuccess(c, data)
}

func startPluginLogin(c *gin.Context, ownerScoped bool) {
	identity, ok := pluginLoginIdentity(c, ownerScoped)
	if !ok {
		return
	}
	channelID, ok := pluginLoginChannelID(c)
	if !ok {
		return
	}
	var request pluginLoginStartRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil && !errors.Is(err, io.EOF) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := service.StartPluginLogin(c.Request.Context(), identity, channelID, request.KeyIndex, request.Add)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	finishPluginLogin(c, result, gin.H{"flow": result.Flow})
}

// StartPluginLogin opens a plugin login flow on an administrator channel.
func StartPluginLogin(c *gin.Context) {
	startPluginLogin(c, false)
}

// StartUserPluginLogin opens a plugin login flow on a seller-owned channel.
func StartUserPluginLogin(c *gin.Context) {
	startPluginLogin(c, true)
}

func continuePluginLogin(c *gin.Context, ownerScoped bool) {
	identity, ok := pluginLoginIdentity(c, ownerScoped)
	if !ok {
		return
	}
	channelID, ok := pluginLoginChannelID(c)
	if !ok {
		return
	}
	var request pluginLoginContinueRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := service.ContinuePluginLogin(c.Request.Context(), identity, channelID, request.Flow, request.Input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	finishPluginLogin(c, result, gin.H{})
}

// ContinuePluginLogin submits the browser's input to an administrator flow.
func ContinuePluginLogin(c *gin.Context) {
	continuePluginLogin(c, false)
}

// ContinueUserPluginLogin submits the browser's input to a seller flow.
func ContinueUserPluginLogin(c *gin.Context) {
	continuePluginLogin(c, true)
}

func completePluginLoginCallback(c *gin.Context, ownerScoped bool) {
	identity, ok := pluginLoginIdentity(c, ownerScoped)
	if !ok {
		return
	}
	var request pluginLoginCallbackRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	result, err := service.CompletePluginLoginCallback(c.Request.Context(), identity, request.Plugin, request.Params)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	finishPluginLogin(c, result, gin.H{"channel_id": result.ChannelID})
}

// CompletePluginLoginCallback receives an administrator flow callback.
func CompletePluginLoginCallback(c *gin.Context) {
	completePluginLoginCallback(c, false)
}

// CompleteUserPluginLoginCallback receives a seller flow callback.
func CompleteUserPluginLoginCallback(c *gin.Context) {
	completePluginLoginCallback(c, true)
}

func getPluginCredentials(c *gin.Context, ownerScoped bool) {
	channelID, ok := pluginLoginChannelID(c)
	if !ok {
		return
	}
	if ownerScoped {
		if _, err := model.GetChannelForOwner(channelID, c.GetInt("id")); err != nil {
			common.ApiError(c, model.ErrChannelNotFound)
			return
		}
	}
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		common.ApiErrorT(c, "Channel does not exist")
		return
	}
	common.ApiSuccess(c, gin.H{"items": service.PluginCredentialViews(channel)})
}

// GetPluginCredentials lists an administrator channel's credential summaries.
func GetPluginCredentials(c *gin.Context) {
	getPluginCredentials(c, false)
}

// GetUserPluginCredentials lists a seller-owned channel's credential summaries.
func GetUserPluginCredentials(c *gin.Context) {
	getPluginCredentials(c, true)
}
