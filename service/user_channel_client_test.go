package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
)

func TestUserChannelPortWhitelistUsesLiveMarketplaceSetting(t *testing.T) {
	previous := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(previous))
	})

	const target = "https://93.184.216.34:17000/v1"
	assert.Error(t, ValidateUserChannelBaseURL(target))

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		token_package_setting.KeyPortWhitelistEnabled: "true",
		token_package_setting.KeyAllowedPorts:         "[80,443,17000]",
	}))
	assert.NoError(t, ValidateUserChannelBaseURL(target))

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		token_package_setting.KeyPortWhitelistEnabled: "false",
	}))
	assert.NoError(t, ValidateUserChannelBaseURL("https://93.184.216.34:17001/v1"))
}
