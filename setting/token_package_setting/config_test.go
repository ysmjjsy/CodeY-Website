package token_package_setting

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokenPackageSettingDefaultsAndLoadFromDB(t *testing.T) {
	previous := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previous))
	})

	snap := GetTokenPackageSetting()
	assert.False(t, snap.Enabled)
	assert.Empty(t, snap.SellerGroups)
	assert.Equal(t, 1000, snap.CommissionBps)
	assert.Equal(t, 3, snap.FreezeDays)
	assert.Equal(t, 0.01, snap.MultiplierMin)
	assert.Equal(t, 10.0, snap.MultiplierMax)
	assert.True(t, snap.AdminSkipReview)
	assert.Equal(t, 0.1, snap.LowBalanceRatio)
	assert.True(t, IsChannelTypeAllowed(constant.ChannelTypeOpenAI))
	assert.True(t, IsChannelTypeAllowed(constant.ChannelTypeAnthropic))
	assert.False(t, IsChannelTypeAllowed(constant.ChannelTypeTaskPlugin))
	assert.False(t, IsChannelTypeAllowed(constant.ChannelTypeAdvancedCustom))

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		KeyEnabled:       "true",
		KeySellerGroups:  `["vip","svip"]`,
		KeyCommissionBps: "1500",
	}))
	updated := GetTokenPackageSetting()
	assert.True(t, updated.Enabled)
	assert.Equal(t, []string{"vip", "svip"}, updated.SellerGroups)
	assert.Equal(t, 1500, updated.CommissionBps)
	assert.True(t, IsSellerGroupAllowed("vip"))
	assert.False(t, IsSellerGroupAllowed("default"))
}

func TestValidateTokenPackageOptionAndMap(t *testing.T) {
	previous := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previous))
	})

	t.Setenv("REALNAME_HASH_SECRET", "test-secret")
	assert.NoError(t, ValidateTokenPackageOption(KeyEnabled, "true"))
	require.NoError(t, os.Unsetenv("REALNAME_HASH_SECRET"))
	assert.Error(t, ValidateTokenPackageOption(KeyEnabled, "true"), "the market stays off without a hash secret")
	t.Setenv("REALNAME_HASH_SECRET", "test-secret")
	assert.Error(t, ValidateTokenPackageOption(KeyEnabled, "not-a-bool"))

	assert.NoError(t, ValidateTokenPackageOption(KeyCommissionBps, "0"))
	assert.NoError(t, ValidateTokenPackageOption(KeyCommissionBps, "10000"))
	assert.Error(t, ValidateTokenPackageOption(KeyCommissionBps, "-1"))
	assert.Error(t, ValidateTokenPackageOption(KeyCommissionBps, "10001"))

	assert.NoError(t, ValidateTokenPackageOption(KeyFreezeDays, "0"))
	assert.Error(t, ValidateTokenPackageOption(KeyFreezeDays, "-1"))

	assert.Error(t, ValidateTokenPackageOption(KeyMultiplierMin, "0"))
	assert.Error(t, ValidateTokenPackageOption(KeyMultiplierMin, "NaN"))
	assert.Error(t, ValidateTokenPackageOption(KeyMultiplierMin, "20")) // > default max 10
	assert.Error(t, ValidateTokenPackageOption(KeyMultiplierMax, "0.001"))

	// Atomic coupled update of [multiplier_min, multiplier_max]
	assert.NoError(t, ValidateTokenPackageOptionMap(map[string]string{
		KeyMultiplierMin: "20",
		KeyMultiplierMax: "50",
	}))
	assert.Error(t, ValidateTokenPackageOptionMap(map[string]string{
		KeyMultiplierMin: "60",
		KeyMultiplierMax: "50",
	}))

	assert.NoError(t, ValidateTokenPackageOption(KeySellerGroups, `["vip"]`))
	assert.Error(t, ValidateTokenPackageOption(KeySellerGroups, `["pkg:1"]`))
	assert.Error(t, ValidateTokenPackageOption(KeySellerGroups, `["auto"]`))
	assert.Error(t, ValidateTokenPackageOption(KeySellerGroups, `[""]`))

	assert.NoError(t, ValidateTokenPackageOption(KeyAllowedChannelTypes, `[1,14,24]`))
	assert.Error(t, ValidateTokenPackageOption(KeyAllowedChannelTypes, `[61]`))
	assert.Error(t, ValidateTokenPackageOption(KeyAllowedChannelTypes, `[58]`))
	assert.Error(t, ValidateTokenPackageOption(KeyAllowedChannelTypes, `[2]`))
	assert.Error(t, ValidateTokenPackageOption(KeyAllowedChannelTypes, `[99999]`))

	assert.NoError(t, ValidateTokenPackageOption(KeyLowBalanceRatio, "0.15"))
	assert.Error(t, ValidateTokenPackageOption(KeyLowBalanceRatio, "-0.1"))
	assert.Error(t, ValidateTokenPackageOption(KeyLowBalanceRatio, "1.1"))
}
