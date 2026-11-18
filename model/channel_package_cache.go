package model

import (
	"fmt"
	"math/rand"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// MaxTokenPackageBindingWeight bounds a binding's routing weight. Versions are
// validated against it, and the router clamps to it as well, so the weight sum
// of a priority tier always fits in an int.
const MaxTokenPackageBindingWeight uint = 10000

// packageChannelCandidate is one enabled channel bound to a package's active
// version. Priority and weight come from the version binding, not from the
// channel, because a seller may tune package traffic separately.
type packageChannelCandidate struct {
	ChannelId int
	Priority  int64
	Weight    uint
}

// package2model2channels mirrors group2model2channels for package routing:
// package id → model → bound channels. It is replaced under channelSyncLock by
// InitChannelCache so a routing decision never sees a half-built index.
var package2model2channels map[int]map[string][]packageChannelCandidate

// packageRoutableStatuses are the package states that may still serve requests.
// A stopped package no longer sells but keeps serving entitlements already sold,
// so it must stay routable until it is terminated.
var packageRoutableStatuses = []string{
	constant.TokenPackageStatusListed,
	constant.TokenPackageStatusPaused,
	constant.TokenPackageStatusStopped,
}

type packageRoutingRow struct {
	PackageId    int
	SellerUserId int
	ChannelId    int
	Models       string
	Priority     int64
	Weight       uint
}

func loadPackageRoutingRows() ([]packageRoutingRow, error) {
	rows := make([]packageRoutingRow, 0)
	err := DB.Table("token_packages AS p").
		Select("p.id AS package_id, p.seller_user_id AS seller_user_id, c.channel_id AS channel_id, c.models AS models, c.priority AS priority, c.weight AS weight").
		Joins("JOIN token_package_versions AS v ON v.id = p.active_version_id AND v.status = ?", constant.TokenPackageVersionStatusApproved).
		Joins("JOIN token_package_channels AS c ON c.version_id = v.id").
		Where("p.status IN ?", packageRoutableStatuses).
		Scan(&rows).Error
	return rows, err
}

// buildPackageRoutingIndex collects every routable (package, model, channel)
// triple. A channel is only reachable through a package when it is enabled and
// still owned by that package's seller, so a deleted or transferred channel can
// never keep serving buyers.
func buildPackageRoutingIndex(channels map[int]*Channel) map[int]map[string][]packageChannelCandidate {
	index := make(map[int]map[string][]packageChannelCandidate)
	rows, err := loadPackageRoutingRows()
	if err != nil {
		common.SysError(common.LogText("failed to load package routing rows: %s", err.Error()))
		return index
	}
	for _, row := range rows {
		channel, ok := channels[row.ChannelId]
		if !ok || channel.Status != common.ChannelStatusEnabled || channel.OwnerUserId != row.SellerUserId {
			continue
		}
		binding := TokenPackageChannel{}
		binding.Models = row.Models
		channelModels := make(map[string]struct{})
		for _, name := range channel.GetModels() {
			channelModels[name] = struct{}{}
		}
		for _, modelName := range binding.GetModels() {
			if _, ok := channelModels[modelName]; !ok {
				continue
			}
			byModel, exists := index[row.PackageId]
			if !exists {
				byModel = make(map[string][]packageChannelCandidate)
				index[row.PackageId] = byModel
			}
			byModel[modelName] = append(byModel[modelName], packageChannelCandidate{
				ChannelId: row.ChannelId,
				Priority:  row.Priority,
				Weight:    row.Weight,
			})
		}
	}
	for _, byModel := range index {
		for modelName, candidates := range byModel {
			sort.SliceStable(candidates, func(i, j int) bool {
				return candidates[i].Priority > candidates[j].Priority
			})
			byModel[modelName] = candidates
		}
	}
	return index
}

// packageCandidatesForModel resolves the candidate list for one model through
// the exact name first, then through the routing-normalized name.
func packageCandidatesForModel(index map[int]map[string][]packageChannelCandidate, packageId int, modelName string) []packageChannelCandidate {
	byModel := index[packageId]
	if len(byModel) == 0 {
		return nil
	}
	if candidates := byModel[modelName]; len(candidates) > 0 {
		return candidates
	}
	if normalized := ratio_setting.RoutingMatchModelName(modelName); normalized != modelName {
		return byModel[normalized]
	}
	return nil
}

func pickPackageCandidate(candidates []packageChannelCandidate, retry int) (*packageChannelCandidate, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	priorities := make([]int64, 0, len(candidates))
	seen := make(map[int64]bool, len(candidates))
	for _, candidate := range candidates {
		if !seen[candidate.Priority] {
			seen[candidate.Priority] = true
			priorities = append(priorities, candidate.Priority)
		}
	}
	sort.Slice(priorities, func(i, j int) bool { return priorities[i] > priorities[j] })
	if retry >= len(priorities) {
		retry = len(priorities) - 1
	}
	if retry < 0 {
		retry = 0
	}
	target := priorities[retry]
	tier := make([]packageChannelCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.Priority == target {
			tier = append(tier, candidate)
		}
	}
	if len(tier) == 1 {
		return &tier[0], nil
	}
	totalWeight := 0
	for _, candidate := range tier {
		totalWeight += int(min(max(candidate.Weight, 1), MaxTokenPackageBindingWeight))
	}
	pick := rand.Intn(totalWeight)
	for i := range tier {
		pick -= int(min(max(tier[i].Weight, 1), MaxTokenPackageBindingWeight))
		if pick < 0 {
			return &tier[i], nil
		}
	}
	return &tier[len(tier)-1], nil
}

// GetRandomSatisfiedPackageChannel selects a channel for a package request. It
// never consults group routing: only channels bound to the package's active
// approved version are candidates.
func GetRandomSatisfiedPackageChannel(packageId int, modelName string, retry int, filters []dto.ChannelFilter) (*Channel, error) {
	if packageId <= 0 {
		return nil, nil
	}
	if !common.MemoryCacheEnabled {
		return getRandomSatisfiedPackageChannelFromDB(packageId, modelName, retry, filters)
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	candidates := packageCandidatesForModel(package2model2channels, packageId, modelName)
	if len(candidates) == 0 {
		return nil, nil
	}
	ids := make([]int, 0, len(candidates))
	for _, candidate := range candidates {
		ids = append(ids, candidate.ChannelId)
	}
	kept, _ := filterCandidateIDs(ids, modelName, filters)
	if len(kept) == 0 {
		return nil, nil
	}
	allowed := make(map[int]struct{}, len(kept))
	for _, id := range kept {
		allowed[id] = struct{}{}
	}
	filtered := make([]packageChannelCandidate, 0, len(kept))
	for _, candidate := range candidates {
		if _, ok := allowed[candidate.ChannelId]; ok {
			filtered = append(filtered, candidate)
		}
	}
	picked, err := pickPackageCandidate(filtered, retry)
	if err != nil || picked == nil {
		return nil, err
	}
	channel, ok := channelsIDM[picked.ChannelId]
	if !ok {
		return nil, fmt.Errorf("database consistency error: channel #%d does not exist, please contact the administrator", picked.ChannelId)
	}
	return channel, nil
}

func getRandomSatisfiedPackageChannelFromDB(packageId int, modelName string, retry int, filters []dto.ChannelFilter) (*Channel, error) {
	rows, err := loadPackageRoutingRows()
	if err != nil {
		return nil, err
	}
	candidates := make([]packageChannelCandidate, 0)
	seen := make(map[int]bool)
	for _, row := range rows {
		if row.PackageId != packageId {
			continue
		}
		binding := TokenPackageChannel{Models: row.Models}
		matches := false
		for _, bound := range binding.GetModels() {
			if bound == modelName {
				matches = true
				break
			}
			if normalized := ratio_setting.RoutingMatchModelName(modelName); bound == normalized {
				matches = true
				break
			}
		}
		if !matches || seen[row.ChannelId] {
			continue
		}
		channel, err := GetChannelById(row.ChannelId, true)
		if err != nil || channel.Status != common.ChannelStatusEnabled || channel.OwnerUserId != row.SellerUserId {
			continue
		}
		if ok, _ := ChannelSatisfiesFilters(channel, modelName, filters); !ok {
			continue
		}
		seen[row.ChannelId] = true
		candidates = append(candidates, packageChannelCandidate{ChannelId: row.ChannelId, Priority: row.Priority, Weight: row.Weight})
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].Priority > candidates[j].Priority })
	picked, err := pickPackageCandidate(candidates, retry)
	if err != nil || picked == nil {
		return nil, err
	}
	return GetChannelById(picked.ChannelId, true)
}

// IsChannelEnabledForPackageModel guards channel affinity: a remembered channel
// is only reused while it still belongs to the package serving the request.
func IsChannelEnabledForPackageModel(packageId int, modelName string, channelId int) bool {
	if packageId <= 0 || modelName == "" || channelId <= 0 {
		return false
	}
	if !common.MemoryCacheEnabled {
		rows, err := loadPackageRoutingRows()
		if err != nil {
			return false
		}
		for _, row := range rows {
			if row.PackageId != packageId || row.ChannelId != channelId {
				continue
			}
			channel, err := GetChannelById(row.ChannelId, true)
			if err != nil || channel.Status != common.ChannelStatusEnabled || channel.OwnerUserId != row.SellerUserId {
				continue
			}
			for _, bound := range (&TokenPackageChannel{Models: row.Models}).GetModels() {
				if bound == modelName {
					return true
				}
			}
		}
		return false
	}
	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()
	for _, candidate := range packageCandidatesForModel(package2model2channels, packageId, modelName) {
		if candidate.ChannelId == channelId {
			return true
		}
	}
	return false
}

// PurgePackageRoutingChannel drops a channel from the package index. It is a
// defensive fallback for callers that mutate a channel outside the full cache
// reload, which itself always rebuilds the index.
func PurgePackageRoutingChannel(channelId int) {
	if !common.MemoryCacheEnabled || channelId <= 0 {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	for _, byModel := range package2model2channels {
		for modelName, candidates := range byModel {
			kept := candidates[:0]
			for _, candidate := range candidates {
				if candidate.ChannelId != channelId {
					kept = append(kept, candidate)
				}
			}
			byModel[modelName] = kept
		}
	}
}

// PurgePackageRouting drops one package from the in-memory routing index so a
// terminated package cannot keep receiving requests through cached entries.
func PurgePackageRouting(packageId int) {
	if packageId <= 0 {
		return
	}
	channelSyncLock.Lock()
	defer channelSyncLock.Unlock()
	delete(package2model2channels, packageId)
}
