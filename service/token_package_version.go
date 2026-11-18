package service

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

// TokenPackageVersionChange classifies an edit against the version that is
// currently serving. Review-required changes wait for an admin; auto-eligible
// changes take effect after the connection check passes.
// Limits on one package version. They keep the connection check, which tests
// every bound channel against every model it serves, to a bounded size, and
// keep seller-entered numbers inside the ranges billing and routing handle.
const (
	MaxTokenPackageVersionModels   = 50
	MaxTokenPackageVersionChannels = 10
	MaxTokenPackageVersionSKUs     = 10
	MaxTokenPackageBindingPriority = 10000
)

type TokenPackageVersionChange int

const (
	TokenPackageVersionChangeInitial TokenPackageVersionChange = iota
	TokenPackageVersionChangeRequiresReview
	TokenPackageVersionChangeAutoEligible
)

// ValidateTokenPackageVersionSpec checks the model multipliers and SKUs of a
// version against the marketplace settings.
func ValidateTokenPackageVersionSpec(specs []dto.TokenPackageModelSpec, skus []dto.TokenPackageSKU) error {
	if len(specs) == 0 {
		return common.NewMessage("Select at least one model")
	}
	if len(specs) > MaxTokenPackageVersionModels {
		return common.NewMessage("A package can offer at most {{count}} models", map[string]any{"count": MaxTokenPackageVersionModels})
	}
	settings := token_package_setting.GetTokenPackageSetting()
	seenModels := make(map[string]struct{}, len(specs))
	for i := range specs {
		// Names are stored trimmed, so the model gate and change
		// classification compare the same strings validation checked.
		specs[i].Model = strings.TrimSpace(specs[i].Model)
		spec := specs[i]
		name := spec.Model
		if name == "" {
			return common.NewMessage("Model name cannot be empty")
		}
		if len(name) > 255 {
			return common.NewMessage("Model name is too long: {{model}}", map[string]any{"model": name})
		}
		if _, duplicate := seenModels[name]; duplicate {
			return common.NewMessage("Model {{model}} is listed twice", map[string]any{"model": name})
		}
		seenModels[name] = struct{}{}
		if math.IsNaN(spec.Multiplier) || math.IsInf(spec.Multiplier, 0) {
			return common.NewMessage("Multiplier for {{model}} is invalid", map[string]any{"model": name})
		}
		if spec.Multiplier < settings.MultiplierMin || spec.Multiplier > settings.MultiplierMax {
			return common.NewMessage("Multiplier for {{model}} must be between {{min}} and {{max}}", map[string]any{
				"model": name, "min": settings.MultiplierMin, "max": settings.MultiplierMax,
			})
		}
	}

	if len(skus) == 0 {
		return common.NewMessage("Add at least one SKU")
	}
	if len(skus) > MaxTokenPackageVersionSKUs {
		return common.NewMessage("A package can offer at most {{count}} SKUs", map[string]any{"count": MaxTokenPackageVersionSKUs})
	}
	seenKeys := make(map[string]struct{}, len(skus))
	for i := range skus {
		skus[i].SKUKey = strings.TrimSpace(skus[i].SKUKey)
		skus[i].Title = strings.TrimSpace(skus[i].Title)
		sku := skus[i]
		key := sku.SKUKey
		if key == "" {
			return common.NewMessage("SKU key cannot be empty")
		}
		if len(key) > 64 {
			return common.NewMessage("SKU key is too long: {{key}}", map[string]any{"key": key})
		}
		if _, duplicate := seenKeys[key]; duplicate {
			return common.NewMessage("SKU {{key}} is listed twice", map[string]any{"key": key})
		}
		seenKeys[key] = struct{}{}
		if strings.TrimSpace(sku.Title) == "" {
			return common.NewMessage("SKU {{key}} needs a title", map[string]any{"key": key})
		}
		if len(sku.Title) > 128 {
			return common.NewMessage("SKU title is too long: {{key}}", map[string]any{"key": key})
		}
		if sku.PriceQuota <= 0 {
			return common.NewMessage("SKU {{key}} price must be greater than zero", map[string]any{"key": key})
		}
		if sku.CreditQuota <= 0 {
			return common.NewMessage("SKU {{key}} quota must be greater than zero", map[string]any{"key": key})
		}
		// Price and credit are wallet amounts: keep them inside the wallet
		// boundary so commission and refund arithmetic cannot overflow.
		if sku.PriceQuota > common.MaxWalletQuota || sku.CreditQuota > common.MaxWalletQuota {
			return common.NewMessage("SKU {{key}} price or quota is too large", map[string]any{"key": key})
		}
		if sku.ValidDays <= 0 || sku.ValidDays > 3650 {
			return common.NewMessage("SKU {{key}} valid days must be between 1 and 3650", map[string]any{"key": key})
		}
	}
	return nil
}

// ValidateTokenPackageBindings checks that every bound channel belongs to the
// seller, uses an allowed type, is enabled, and actually serves the models the
// binding claims.
func ValidateTokenPackageBindings(bindings []dto.TokenPackageChannelBinding, specs []dto.TokenPackageModelSpec, sellerUserId int) error {
	if len(bindings) == 0 {
		return common.NewMessage("Bind at least one channel")
	}
	if len(bindings) > MaxTokenPackageVersionChannels {
		return common.NewMessage("A package can bind at most {{count}} channels", map[string]any{"count": MaxTokenPackageVersionChannels})
	}
	versionModels := make(map[string]struct{}, len(specs))
	for _, spec := range specs {
		versionModels[strings.TrimSpace(spec.Model)] = struct{}{}
	}
	servedModels := make(map[string]struct{}, len(specs))
	seenChannels := make(map[int]struct{}, len(bindings))
	for i := range bindings {
		for j := range bindings[i].Models {
			bindings[i].Models[j] = strings.TrimSpace(bindings[i].Models[j])
		}
		binding := bindings[i]
		if binding.ChannelID <= 0 {
			return common.NewMessage("Channel id is required")
		}
		// Weights are summed by the router; an unbounded one would overflow
		// the sum and break routing for the whole package.
		if binding.Weight > model.MaxTokenPackageBindingWeight {
			return common.NewMessage("Channel {{id}} weight must be at most {{max}}", map[string]any{"id": binding.ChannelID, "max": model.MaxTokenPackageBindingWeight})
		}
		if binding.Priority < -MaxTokenPackageBindingPriority || binding.Priority > MaxTokenPackageBindingPriority {
			return common.NewMessage("Channel {{id}} priority must be between {{min}} and {{max}}", map[string]any{"id": binding.ChannelID, "min": -MaxTokenPackageBindingPriority, "max": MaxTokenPackageBindingPriority})
		}
		if _, duplicate := seenChannels[binding.ChannelID]; duplicate {
			return common.NewMessage("Channel {{id}} is bound twice", map[string]any{"id": binding.ChannelID})
		}
		seenChannels[binding.ChannelID] = struct{}{}
		channel, err := model.GetChannelById(binding.ChannelID, false)
		if err != nil {
			return common.NewMessage("Channel {{id}} does not exist", map[string]any{"id": binding.ChannelID})
		}
		if channel.OwnerUserId != sellerUserId {
			return common.NewMessage("Channel {{id}} does not belong to you", map[string]any{"id": binding.ChannelID})
		}
		if !token_package_setting.IsChannelTypeAllowed(channel.Type) {
			return common.NewMessage("Channel {{id}} uses a type that is not allowed", map[string]any{"id": binding.ChannelID})
		}
		if channel.Status != common.ChannelStatusEnabled {
			return common.NewMessage("Channel {{id}} is disabled", map[string]any{"id": binding.ChannelID})
		}
		if len(binding.Models) == 0 {
			return common.NewMessage("Channel {{id}} needs at least one model", map[string]any{"id": binding.ChannelID})
		}
		channelModels := make(map[string]struct{})
		for _, modelName := range channel.GetModels() {
			channelModels[modelName] = struct{}{}
		}
		for _, modelName := range binding.Models {
			if _, ok := versionModels[modelName]; !ok {
				return common.NewMessage("Channel {{id}} serves {{model}}, which this version does not offer", map[string]any{"id": binding.ChannelID, "model": modelName})
			}
			if _, ok := channelModels[modelName]; !ok {
				return common.NewMessage("Channel {{id}} does not declare model {{model}}", map[string]any{"id": binding.ChannelID, "model": modelName})
			}
			servedModels[modelName] = struct{}{}
		}
	}
	// Every model the package sells must be routable: a model no channel
	// serves would be sold but never tested or served.
	for _, spec := range specs {
		name := strings.TrimSpace(spec.Model)
		if _, ok := servedModels[name]; !ok {
			return common.NewMessage("No bound channel serves model {{model}}", map[string]any{"model": name})
		}
	}
	return nil
}

func tokenPackageSpecMap(specs []dto.TokenPackageModelSpec) map[string]float64 {
	result := make(map[string]float64, len(specs))
	for _, spec := range specs {
		result[strings.TrimSpace(spec.Model)] = spec.Multiplier
	}
	return result
}

func tokenPackageSKUMap(skus []dto.TokenPackageSKU) map[string]dto.TokenPackageSKU {
	result := make(map[string]dto.TokenPackageSKU, len(skus))
	for _, sku := range skus {
		result[sku.SKUKey] = sku
	}
	return result
}

// bindingSignature captures the routing shape of a version so any change that
// can move traffic or prices needs a human review.
func bindingSignature(bindings []dto.TokenPackageChannelBinding) string {
	parts := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		models := slices.Clone(binding.Models)
		slices.Sort(models)
		parts = append(parts, fmt.Sprintf("%d:%s", binding.ChannelID, strings.Join(models, "|")))
	}
	slices.Sort(parts)
	return strings.Join(parts, ";")
}

// ClassifyTokenPackageVersionChange decides whether a new version can take
// effect after the automated check or needs manual review (design §9.4).
func ClassifyTokenPackageVersionChange(previousSpecs, nextSpecs []dto.TokenPackageModelSpec, previousSKUs, nextSKUs []dto.TokenPackageSKU, previousBindings, nextBindings []dto.TokenPackageChannelBinding) TokenPackageVersionChange {
	if len(previousSpecs) == 0 && len(previousSKUs) == 0 {
		return TokenPackageVersionChangeInitial
	}
	previousModels := tokenPackageSpecMap(previousSpecs)
	nextModels := tokenPackageSpecMap(nextSpecs)
	if len(previousModels) != len(nextModels) {
		return TokenPackageVersionChangeRequiresReview
	}
	for name, multiplier := range nextModels {
		previousMultiplier, ok := previousModels[name]
		if !ok || multiplier > previousMultiplier {
			return TokenPackageVersionChangeRequiresReview
		}
	}
	previousSKUByKey := tokenPackageSKUMap(previousSKUs)
	for key, sku := range tokenPackageSKUMap(nextSKUs) {
		previous, ok := previousSKUByKey[key]
		if !ok {
			continue
		}
		if sku.PriceQuota > previous.PriceQuota || sku.CreditQuota < previous.CreditQuota || sku.ValidDays < previous.ValidDays {
			return TokenPackageVersionChangeRequiresReview
		}
	}
	nextSKUKeys := make(map[string]struct{}, len(nextSKUs))
	for _, sku := range nextSKUs {
		nextSKUKeys[sku.SKUKey] = struct{}{}
	}
	for key := range previousSKUByKey {
		if _, ok := nextSKUKeys[key]; !ok {
			return TokenPackageVersionChangeRequiresReview
		}
	}
	if bindingSignature(previousBindings) != bindingSignature(nextBindings) {
		return TokenPackageVersionChangeRequiresReview
	}
	return TokenPackageVersionChangeAutoEligible
}
