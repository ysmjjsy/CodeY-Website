package setting

import (
	"errors"
	"net/url"
	"slices"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	TaskPluginMarketplaceSourcesKey                  = "TaskPluginMarketplaceSources"
	TaskPluginCommunityEnabledKey                    = "TaskPluginCommunityEnabled"
	TaskPluginMarketplaceShortCodesEnabledKey        = "TaskPluginMarketplaceShortCodesEnabled"
	TaskPluginMarketplaceInstallStatsEnabledKey      = "TaskPluginMarketplaceInstallStatsEnabled"
	TaskPluginMarketplaceRemoteRevocationsEnabledKey = "TaskPluginMarketplaceRemoteRevocationsEnabled"
	TaskPluginDisabledFactoryKeysKey                 = "TaskPluginDisabledFactoryKeys"

	TaskPluginMarketplaceKindOfficial   = "official"
	TaskPluginMarketplaceKindCommunity  = "community"
	TaskPluginMarketplaceKindThirdParty = "third_party"
)

type TaskPluginMarketplaceSource struct {
	Name     string `json:"name"`
	IndexURL string `json:"index_url"`
	// Kind is assigned by the administrator, never by the downloaded index.
	// An omitted kind on an existing source grants no official-source trust.
	Kind string `json:"kind"`
}

// NormalizeTaskPluginMarketplaceSource validates explicitly configured sources.
// Obsolete upstream marketplace addresses cannot be restored by old settings.
func NormalizeTaskPluginMarketplaceSource(source TaskPluginMarketplaceSource) (TaskPluginMarketplaceSource, error) {
	source.Name = strings.TrimSpace(source.Name)
	source.IndexURL = strings.TrimSpace(source.IndexURL)
	source.Kind = strings.TrimSpace(source.Kind)
	if source.Name == "" {
		return source, errors.New("marketplace source name is required")
	}
	parsed, err := url.Parse(source.IndexURL)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || (!strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https")) {
		return source, errors.New("marketplace source index_url must be an absolute http(s) URL without credentials or a fragment")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "newapi.ai" || strings.HasSuffix(host, ".newapi.ai") || host == "newapi.pro" || strings.HasSuffix(host, ".newapi.pro") ||
		((host == "github.com" || host == "raw.githubusercontent.com") && strings.HasPrefix(strings.ToLower(parsed.Path), "/quantumnous/new-api-plugins/")) {
		return source, errors.New("this legacy marketplace source is no longer supported")
	}
	if source.Kind == "" {
		source.Kind = TaskPluginMarketplaceKindThirdParty
	}
	switch source.Kind {
	case TaskPluginMarketplaceKindOfficial, TaskPluginMarketplaceKindCommunity, TaskPluginMarketplaceKindThirdParty:
		return source, nil
	default:
		return source, errors.New("invalid marketplace source kind")
	}
}

func GetTaskPluginMarketplaceSources() []TaskPluginMarketplaceSource {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[TaskPluginMarketplaceSourcesKey]
	common.OptionMapRWMutex.RUnlock()

	var saved []TaskPluginMarketplaceSource
	if common.UnmarshalJsonStr(raw, &saved) != nil {
		return []TaskPluginMarketplaceSource{}
	}
	sources := make([]TaskPluginMarketplaceSource, 0, len(saved))
	for _, source := range saved {
		if normalized, err := NormalizeTaskPluginMarketplaceSource(source); err == nil && !slices.ContainsFunc(sources, func(existing TaskPluginMarketplaceSource) bool { return existing.IndexURL == normalized.IndexURL }) {
			sources = append(sources, normalized)
		}
	}
	return sources
}

func TaskPluginMarketplaceSourceKind(indexURL string) string {
	for _, source := range GetTaskPluginMarketplaceSources() {
		if source.IndexURL == strings.TrimSpace(indexURL) {
			return source.Kind
		}
	}
	return TaskPluginMarketplaceKindThirdParty
}

func IsTaskPluginCommunityEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[TaskPluginCommunityEnabledKey] == "true"
}

// These optional market features never activate from the presence of a source.
// Installation reporting is not implemented, even when install counts are shown.
func IsTaskPluginMarketplaceShortCodesEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[TaskPluginMarketplaceShortCodesEnabledKey] == "true"
}

func IsTaskPluginMarketplaceInstallStatsEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[TaskPluginMarketplaceInstallStatsEnabledKey] == "true"
}

func IsTaskPluginMarketplaceRemoteRevocationsEnabled() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[TaskPluginMarketplaceRemoteRevocationsEnabledKey] == "true"
}

func TaskPluginMarketplaceSources2JsonString() string {
	return "[]"
}

func ParseTaskPluginDisabledFactoryKeys(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return []string{}
	}
	var keys []string
	if err := common.Unmarshal([]byte(raw), &keys); err != nil {
		return []string{}
	}
	if keys == nil {
		return []string{}
	}
	return keys
}

func GetTaskPluginDisabledFactoryKeys() []string {
	common.OptionMapRWMutex.RLock()
	raw := ""
	if common.OptionMap != nil {
		raw = common.OptionMap[TaskPluginDisabledFactoryKeysKey]
	}
	common.OptionMapRWMutex.RUnlock()
	return ParseTaskPluginDisabledFactoryKeys(raw)
}

func SetTaskPluginDisabledFactoryKeysOption(keys []string) error {
	normalized := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, key)
	}
	sort.Strings(normalized)
	encoded, err := common.Marshal(normalized)
	if err != nil {
		return err
	}
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMap[TaskPluginDisabledFactoryKeysKey] = string(encoded)
	common.OptionMapRWMutex.Unlock()
	return nil
}

func IsTaskPluginFactoryDisabled(key string) bool {
	return slices.Contains(GetTaskPluginDisabledFactoryKeys(), key)
}
