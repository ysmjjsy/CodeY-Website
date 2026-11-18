package token_package_setting

import (
	"fmt"
	"math"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/config"
)

const OptionPrefix = "token_package_setting."

const (
	KeyEnabled                = OptionPrefix + "enabled"
	KeySellerGroups           = OptionPrefix + "seller_groups"
	KeyCommissionBps          = OptionPrefix + "commission_bps"
	KeyFreezeDays             = OptionPrefix + "freeze_days"
	KeyMultiplierMin          = OptionPrefix + "multiplier_min"
	KeyMultiplierMax          = OptionPrefix + "multiplier_max"
	KeyProbeMinutes           = OptionPrefix + "probe_minutes"
	KeyOutageThresholdMinutes = OptionPrefix + "outage_threshold_minutes"
	KeyAutoTerminateHours     = OptionPrefix + "auto_terminate_hours"
	KeyAllowedChannelTypes    = OptionPrefix + "allowed_channel_types"
	KeyAdminSkipReview        = OptionPrefix + "admin_skip_review"
	KeyLowBalanceRatio        = OptionPrefix + "low_balance_ratio"
	KeyPortWhitelistEnabled   = OptionPrefix + "port_whitelist_enabled"
	KeyAllowedPorts           = OptionPrefix + "allowed_ports"
)

// DefaultAllowedChannelTypes lists standard protocol channel types allowed for
// user-owned channels in the token package marketplace (task plugins, video/MJ,
// and advanced custom channels are excluded).
var DefaultAllowedChannelTypes = []int{
	constant.ChannelTypeOpenAI,
	constant.ChannelTypeAzure,
	constant.ChannelTypeCustom,
	constant.ChannelTypeAnthropic,
	constant.ChannelTypeAli,
	constant.ChannelTypeOpenRouter,
	constant.ChannelTypeTencent,
	constant.ChannelTypeGemini,
	constant.ChannelTypeMoonshot,
	constant.ChannelTypeZhipu_v4,
	constant.ChannelTypePerplexity,
	constant.ChannelTypeAws,
	constant.ChannelTypeCohere,
	constant.ChannelTypeMiniMax,
	constant.ChannelCloudflare,
	constant.ChannelTypeSiliconFlow,
	constant.ChannelTypeVertexAi,
	constant.ChannelTypeMistral,
	constant.ChannelTypeDeepSeek,
	constant.ChannelTypeVolcEngine,
	constant.ChannelTypeBaiduV2,
	constant.ChannelTypeXinference,
	constant.ChannelTypeXai,
	constant.ChannelTypeSubmodel,
	constant.ChannelTypeSub2API,
	constant.ChannelTypeNewAPI,
}

var DefaultAllowedSellerPorts = []int{80, 443, 8080, 8443}

type TokenPackageSetting struct {
	Enabled                bool     `json:"enabled"`
	SellerGroups           []string `json:"seller_groups"`
	CommissionBps          int      `json:"commission_bps"`
	FreezeDays             int      `json:"freeze_days"`
	MultiplierMin          float64  `json:"multiplier_min"`
	MultiplierMax          float64  `json:"multiplier_max"`
	ProbeMinutes           int      `json:"probe_minutes"`
	OutageThresholdMinutes int      `json:"outage_threshold_minutes"`
	AutoTerminateHours     int      `json:"auto_terminate_hours"`
	AllowedChannelTypes    []int    `json:"allowed_channel_types"`
	AdminSkipReview        bool     `json:"admin_skip_review"`
	LowBalanceRatio        float64  `json:"low_balance_ratio"`
	PortWhitelistEnabled   bool     `json:"port_whitelist_enabled"`
	AllowedPorts           []int    `json:"allowed_ports"`
}

var tokenPackageSetting = defaultTokenPackageSetting()

func defaultTokenPackageSetting() TokenPackageSetting {
	return TokenPackageSetting{
		Enabled:                false,
		SellerGroups:           []string{},
		CommissionBps:          1000,
		FreezeDays:             3,
		MultiplierMin:          0.01,
		MultiplierMax:          10,
		ProbeMinutes:           10,
		OutageThresholdMinutes: 30,
		AutoTerminateHours:     72,
		AllowedChannelTypes:    slices.Clone(DefaultAllowedChannelTypes),
		AdminSkipReview:        true,
		LowBalanceRatio:        0.1,
		PortWhitelistEnabled:   true,
		AllowedPorts:           slices.Clone(DefaultAllowedSellerPorts),
	}
}

func init() {
	config.GlobalConfig.Register("token_package_setting", &tokenPackageSetting)
}

// GetTokenPackageSetting returns a defensive copy of the current marketplace settings.
func GetTokenPackageSetting() TokenPackageSetting {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	snapshot := tokenPackageSetting
	snapshot.SellerGroups = slices.Clone(tokenPackageSetting.SellerGroups)
	snapshot.AllowedChannelTypes = slices.Clone(tokenPackageSetting.AllowedChannelTypes)
	snapshot.AllowedPorts = slices.Clone(tokenPackageSetting.AllowedPorts)
	return snapshot
}

func IsEnabled() bool {
	return GetTokenPackageSetting().Enabled
}

func IsChannelTypeAllowed(channelType int) bool {
	// Plugin channels bind a registered plugin instead of a built-in protocol.
	// Their availability follows the plugin registry, so a newly enabled plugin
	// reaches seller channels without editing the built-in type list.
	if channelType == constant.ChannelTypeTaskPlugin {
		return true
	}
	if !isPermittableChannelType(channelType) {
		return false
	}
	return slices.Contains(GetTokenPackageSetting().AllowedChannelTypes, channelType)
}

// PermittableChannelTypes returns the built-in channel types an administrator
// may enable for the marketplace. Plugin channels are handled separately and
// are not part of this list.
func PermittableChannelTypes() []int {
	channelTypes := make([]int, 0, constant.ChannelTypeDummy)
	for channelType := constant.ChannelTypeUnknown + 1; channelType < constant.ChannelTypeDummy; channelType++ {
		if isPermittableChannelType(channelType) {
			channelTypes = append(channelTypes, channelType)
		}
	}
	return channelTypes
}

func IsSellerGroupAllowed(group string) bool {
	if group == "" {
		return false
	}
	return slices.Contains(GetTokenPackageSetting().SellerGroups, group)
}

// AllowedSellerChannelPorts returns the live port policy for seller channels.
// An empty list means any port is allowed; a disabled whitelist therefore maps
// to an empty list. If the whitelist is enabled without any ports, return an
// impossible port so an invalid configuration fails closed.
func AllowedSellerChannelPorts() []int {
	snapshot := GetTokenPackageSetting()
	if !snapshot.PortWhitelistEnabled {
		return nil
	}
	if len(snapshot.AllowedPorts) == 0 {
		return []int{-1}
	}
	return slices.Clone(snapshot.AllowedPorts)
}

func isPermittableChannelType(channelType int) bool {
	if channelType <= constant.ChannelTypeUnknown || channelType >= constant.ChannelTypeDummy {
		return false
	}
	if _, ok := constant.ChannelTypeNames[channelType]; !ok {
		return false
	}
	if constant.IsAdvancedCustomChannel(channelType) || channelType == constant.ChannelTypeTaskPlugin {
		return false
	}
	switch channelType {
	case constant.ChannelTypeMidjourney,
		constant.ChannelTypeMidjourneyPlus,
		constant.ChannelTypeSunoAPI,
		constant.ChannelTypeKling,
		constant.ChannelTypeJimeng,
		constant.ChannelTypeVidu,
		constant.ChannelTypeDoubaoVideo,
		constant.ChannelTypeSora:
		return false
	}
	return true
}

func ValidateTokenPackageOption(key, value string) error {
	if !strings.HasPrefix(key, OptionPrefix) {
		return nil
	}
	current := GetTokenPackageSetting()
	return validateSingleOption(key, value, current.MultiplierMin, current.MultiplierMax, current.PortWhitelistEnabled)
}

// ValidateTokenPackageOptionMap validates one or more token_package_setting.* keys
// together so coupled bounds like multiplier_min <= multiplier_max can be updated atomically.
func ValidateTokenPackageOptionMap(values map[string]string) error {
	current := GetTokenPackageSetting()
	effectiveMin := current.MultiplierMin
	effectiveMax := current.MultiplierMax
	hasMin := false
	hasMax := false

	if rawMin, ok := values[KeyMultiplierMin]; ok {
		parsed, err := parsePositiveFiniteFloat(KeyMultiplierMin, rawMin)
		if err != nil {
			return err
		}
		effectiveMin = parsed
		hasMin = true
	}
	if rawMax, ok := values[KeyMultiplierMax]; ok {
		parsed, err := parsePositiveFiniteFloat(KeyMultiplierMax, rawMax)
		if err != nil {
			return err
		}
		effectiveMax = parsed
		hasMax = true
	}
	if (hasMin || hasMax) && effectiveMin > effectiveMax {
		return fmt.Errorf("%s (%g) cannot exceed %s (%g)", KeyMultiplierMin, effectiveMin, KeyMultiplierMax, effectiveMax)
	}

	effectivePortWhitelistEnabled := current.PortWhitelistEnabled
	effectiveAllowedPorts := slices.Clone(current.AllowedPorts)
	if rawEnabled, ok := values[KeyPortWhitelistEnabled]; ok {
		enabled, err := strconv.ParseBool(rawEnabled)
		if err != nil {
			return fmt.Errorf("%s must be a boolean", KeyPortWhitelistEnabled)
		}
		effectivePortWhitelistEnabled = enabled
	}
	if rawPorts, ok := values[KeyAllowedPorts]; ok {
		ports, err := parseAllowedPorts(rawPorts)
		if err != nil {
			return err
		}
		effectiveAllowedPorts = ports
	}
	if effectivePortWhitelistEnabled && len(effectiveAllowedPorts) == 0 {
		return fmt.Errorf("%s must contain at least one port when the whitelist is enabled", KeyAllowedPorts)
	}

	for key, value := range values {
		if !strings.HasPrefix(key, OptionPrefix) {
			continue
		}
		if err := validateSingleOption(key, value, effectiveMin, effectiveMax, effectivePortWhitelistEnabled); err != nil {
			return err
		}
	}
	return nil
}

func validateSingleOption(key, value string, minBound, maxBound float64, portWhitelistEnabled bool) error {
	switch key {
	case KeyEnabled:
		enabled, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("%s must be a boolean", key)
		}
		// The same-person check hashes ID numbers with this secret. Turning the
		// market on without it would let every identity compare as empty.
		if enabled && strings.TrimSpace(os.Getenv("REALNAME_HASH_SECRET")) == "" {
			return fmt.Errorf("%s requires REALNAME_HASH_SECRET to be configured", key)
		}
	case KeyAdminSkipReview:
		if _, err := strconv.ParseBool(value); err != nil {
			return fmt.Errorf("%s must be a boolean", key)
		}
	case KeyPortWhitelistEnabled:
		if _, err := strconv.ParseBool(value); err != nil {
			return fmt.Errorf("%s must be a boolean", key)
		}
	case KeySellerGroups:
		var groups []string
		if err := common.UnmarshalJsonStr(value, &groups); err != nil || groups == nil {
			return fmt.Errorf("%s must be a JSON array of group names", key)
		}
		for _, g := range groups {
			trimmed := strings.TrimSpace(g)
			if trimmed == "" || trimmed != g {
				return fmt.Errorf("%s entries must be non-empty group names without surrounding whitespace", key)
			}
			if trimmed == "auto" || constant.HasReservedPackageGroupPrefix(trimmed) {
				return fmt.Errorf("%s cannot contain reserved group %q", key, g)
			}
		}
	case KeyCommissionBps:
		bps, err := strconv.Atoi(value)
		if err != nil || bps < 0 || bps > 10000 {
			return fmt.Errorf("%s must be an integer between 0 and 10000", key)
		}
	case KeyFreezeDays:
		days, err := strconv.Atoi(value)
		if err != nil || days < 0 || days > 365 {
			return fmt.Errorf("%s must be an integer between 0 and 365", key)
		}
	case KeyMultiplierMin:
		parsed, err := parsePositiveFiniteFloat(key, value)
		if err != nil {
			return err
		}
		if parsed > maxBound {
			return fmt.Errorf("%s (%g) cannot exceed %s (%g)", key, parsed, KeyMultiplierMax, maxBound)
		}
	case KeyMultiplierMax:
		parsed, err := parsePositiveFiniteFloat(key, value)
		if err != nil {
			return err
		}
		if parsed < minBound {
			return fmt.Errorf("%s (%g) cannot be less than %s (%g)", key, parsed, KeyMultiplierMin, minBound)
		}
	case KeyProbeMinutes, KeyOutageThresholdMinutes, KeyAutoTerminateHours:
		val, err := strconv.Atoi(value)
		if err != nil || val < 1 {
			return fmt.Errorf("%s must be an integer >= 1", key)
		}
	case KeyAllowedChannelTypes:
		var channelTypes []int
		if err := common.UnmarshalJsonStr(value, &channelTypes); err != nil || channelTypes == nil {
			return fmt.Errorf("%s must be a JSON array of channel type IDs", key)
		}
		for _, ct := range channelTypes {
			if !isPermittableChannelType(ct) {
				return fmt.Errorf("%s contains unsupported or disallowed channel type %d", key, ct)
			}
		}
	case KeyAllowedPorts:
		ports, err := parseAllowedPorts(value)
		if err != nil {
			return err
		}
		if portWhitelistEnabled && len(ports) == 0 {
			return fmt.Errorf("%s must contain at least one port when the whitelist is enabled", key)
		}
	case KeyLowBalanceRatio:
		ratio, err := strconv.ParseFloat(value, 64)
		if err != nil || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 || ratio > 1 {
			return fmt.Errorf("%s must be a finite number between 0 and 1", key)
		}
	default:
		return fmt.Errorf("unknown token package setting %q", key)
	}
	return nil
}

func parseAllowedPorts(value string) ([]int, error) {
	var ports []int
	if err := common.UnmarshalJsonStr(value, &ports); err != nil || ports == nil {
		return nil, fmt.Errorf("%s must be a JSON array of port numbers", KeyAllowedPorts)
	}
	seen := make(map[int]struct{}, len(ports))
	for _, port := range ports {
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("%s contains invalid port %d", KeyAllowedPorts, port)
		}
		if _, duplicate := seen[port]; duplicate {
			return nil, fmt.Errorf("%s contains duplicate port %d", KeyAllowedPorts, port)
		}
		seen[port] = struct{}{}
	}
	return ports, nil
}

func parsePositiveFiniteFloat(key, value string) (float64, error) {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a finite number greater than 0", key)
	}
	return parsed, nil
}
