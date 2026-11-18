package setting

import (
	"fmt"
	"slices"
	"strconv"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

const DefaultMaxTokenAutoGroups = 5

var autoGroups = []string{
	"default",
}

var DefaultUseAutoGroup = false

var maxTokenAutoGroups atomic.Int64

func init() {
	maxTokenAutoGroups.Store(DefaultMaxTokenAutoGroups)
}

func ContainsAutoGroup(group string) bool {
	return slices.Contains(autoGroups, group)
}

func CheckAutoGroups(jsonString string) error {
	parsed := make([]string, 0)
	if err := common.UnmarshalJsonStr(jsonString, &parsed); err != nil {
		return err
	}
	for _, group := range parsed {
		if constant.HasReservedPackageGroupPrefix(group) {
			return fmt.Errorf("group name %q uses reserved prefix %q", group, constant.TokenPackageGroupPrefix)
		}
	}
	return nil
}

func UpdateAutoGroupsByJsonString(jsonString string) error {
	parsed := make([]string, 0)
	if err := common.UnmarshalJsonStr(jsonString, &parsed); err != nil {
		return err
	}
	for _, group := range parsed {
		if constant.HasReservedPackageGroupPrefix(group) {
			return fmt.Errorf("group name %q uses reserved prefix %q", group, constant.TokenPackageGroupPrefix)
		}
	}
	autoGroups = parsed
	return nil
}

func AutoGroups2JsonString() string {
	jsonBytes, err := common.Marshal(autoGroups)
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

func GetAutoGroups() []string {
	return autoGroups
}

func GetMaxTokenAutoGroups() int {
	return int(maxTokenAutoGroups.Load())
}

func ValidateMaxTokenAutoGroups(value string) error {
	maxCount, err := strconv.Atoi(value)
	if err != nil || maxCount <= 0 {
		return fmt.Errorf("MaxTokenAutoGroups must be a positive integer")
	}
	return nil
}

func UpdateMaxTokenAutoGroups(value string) error {
	if err := ValidateMaxTokenAutoGroups(value); err != nil {
		return err
	}
	maxCount, _ := strconv.Atoi(value)
	maxTokenAutoGroups.Store(int64(maxCount))
	return nil
}
