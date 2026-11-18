package dto

import "encoding/json"

// UserChannelSettings is the provider-specific subset a seller may control.
// It deliberately excludes channel settings that affect platform routing,
// credentials, plugins, or outbound request policy.
type UserChannelSettings struct {
	AzureResponsesVersion *string `json:"azure_responses_version,omitempty"`
	VertexKeyType         *string `json:"vertex_key_type,omitempty"`
	VertexProjectID       *string `json:"vertex_project_id,omitempty"`
	VertexAPIVersion      *string `json:"vertex_api_version,omitempty"`
	OpenRouterEnterprise  *bool   `json:"openrouter_enterprise,omitempty"`
	AwsKeyType            *string `json:"aws_key_type,omitempty"`
	AwsApiType            *string `json:"aws_api_type,omitempty"`
}

// UserChannelResponse is a seller's own upstream channel. It never carries the
// key: the key is write-only once saved.
type UserChannelResponse struct {
	ID                 int                  `json:"id"`
	Name               string               `json:"name"`
	Type               int                  `json:"type"`
	BaseURL            string               `json:"base_url"`
	OpenAIOrganization string               `json:"openai_organization"`
	Models             []string             `json:"models"`
	ModelMapping       string               `json:"model_mapping"`
	TestModel          string               `json:"test_model"`
	Other              string               `json:"other"`
	Priority           int64                `json:"priority"`
	Weight             int                  `json:"weight"`
	Status             int                  `json:"status"`
	Settings           *UserChannelSettings `json:"settings,omitempty"`
	TaskPluginKey      string               `json:"task_plugin_key,omitempty"`
	PluginConfig       json.RawMessage      `json:"plugin_config,omitempty"`
	CreatedTime        int64                `json:"created_time"`
	BoundPackages      []string             `json:"bound_packages,omitempty"`
}

// CreateUserChannelRequest is the only field set a seller may submit when
// creating an upstream channel. Group, tag, overrides, proxy, and plugin
// bindings are not accepted here at all.
type CreateUserChannelRequest struct {
	Name               string               `json:"name"`
	Type               int                  `json:"type"`
	BaseURL            string               `json:"base_url"`
	Key                string               `json:"key"`
	OpenAIOrganization *string              `json:"openai_organization"`
	Models             []string             `json:"models"`
	ModelMapping       map[string]string    `json:"model_mapping"`
	TestModel          string               `json:"test_model"`
	Other              string               `json:"other"`
	Priority           *int64               `json:"priority"`
	Weight             *uint                `json:"weight"`
	Settings           *UserChannelSettings `json:"settings,omitempty"`
	TaskPluginKey      *string              `json:"task_plugin_key,omitempty"`
	PluginConfig       json.RawMessage      `json:"plugin_config,omitempty"`
}

// UpdateUserChannelRequest edits the mutable, owner-controlled fields. A nil
// pointer means "leave unchanged"; the channel type is immutable because a
// type change alters protocol semantics.
type UpdateUserChannelRequest struct {
	Name               *string              `json:"name"`
	BaseURL            *string              `json:"base_url"`
	Key                *string              `json:"key"`
	OpenAIOrganization *string              `json:"openai_organization"`
	Models             *[]string            `json:"models"`
	ModelMapping       *map[string]string   `json:"model_mapping"`
	TestModel          *string              `json:"test_model"`
	Other              *string              `json:"other"`
	Priority           *int64               `json:"priority"`
	Weight             *uint                `json:"weight"`
	Status             *int                 `json:"status"`
	Settings           *UserChannelSettings `json:"settings,omitempty"`
	TaskPluginKey      *string              `json:"task_plugin_key,omitempty"`
	PluginConfig       json.RawMessage      `json:"plugin_config,omitempty"`
}

// FetchUserChannelModelsRequest asks the platform to list upstream models with
// a candidate base URL and key, or with the stored ones when omitted.
type FetchUserChannelModelsRequest struct {
	BaseURL       string          `json:"base_url"`
	Key           string          `json:"key"`
	TaskPluginKey string          `json:"task_plugin_key"`
	PluginConfig  json.RawMessage `json:"plugin_config"`
}

// BatchUserChannelRequest applies one status or delete action to a bounded set
// of the caller's own channels.
type BatchUserChannelRequest struct {
	Action string `json:"action"`
	IDs    []int  `json:"ids"`
}

type BatchUserChannelFailure struct {
	ID      int    `json:"id"`
	Name    string `json:"name,omitempty"`
	Message string `json:"message"`
}

type BatchUserChannelResponse struct {
	Succeeded []int                     `json:"succeeded"`
	Failed    []BatchUserChannelFailure `json:"failed"`
}
