package dto

// UserChannelResponse is a seller's own upstream channel. It never carries the
// key: the key is write-only once saved.
type UserChannelResponse struct {
	ID            int      `json:"id"`
	Name          string   `json:"name"`
	Type          int      `json:"type"`
	BaseURL       string   `json:"base_url"`
	Models        []string `json:"models"`
	ModelMapping  string   `json:"model_mapping"`
	TestModel     string   `json:"test_model"`
	Other         string   `json:"other"`
	Priority      int64    `json:"priority"`
	Weight        int      `json:"weight"`
	Status        int      `json:"status"`
	CreatedTime   int64    `json:"created_time"`
	BoundPackages []string `json:"bound_packages,omitempty"`
}

// CreateUserChannelRequest is the only field set a seller may submit when
// creating an upstream channel. Group, tag, overrides, proxy, and plugin
// bindings are not accepted here at all.
type CreateUserChannelRequest struct {
	Name         string            `json:"name"`
	Type         int               `json:"type"`
	BaseURL      string            `json:"base_url"`
	Key          string            `json:"key"`
	Models       []string          `json:"models"`
	ModelMapping map[string]string `json:"model_mapping"`
	TestModel    string            `json:"test_model"`
	Other        string            `json:"other"`
	Priority     *int64            `json:"priority"`
	Weight       *uint             `json:"weight"`
}

// UpdateUserChannelRequest edits the mutable, owner-controlled fields. A nil
// pointer means "leave unchanged"; the channel type is immutable because a
// type change alters protocol semantics.
type UpdateUserChannelRequest struct {
	Name         *string            `json:"name"`
	BaseURL      *string            `json:"base_url"`
	Key          *string            `json:"key"`
	Models       *[]string          `json:"models"`
	ModelMapping *map[string]string `json:"model_mapping"`
	TestModel    *string            `json:"test_model"`
	Other        *string            `json:"other"`
	Priority     *int64             `json:"priority"`
	Weight       *uint              `json:"weight"`
	Status       *int               `json:"status"`
}

// FetchUserChannelModelsRequest asks the platform to list upstream models with
// a candidate base URL and key, or with the stored ones when omitted.
type FetchUserChannelModelsRequest struct {
	BaseURL string `json:"base_url"`
	Key     string `json:"key"`
}
