package model

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/request_plugin_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Opt in only with disposable databases. RC51_DB_PHASE is baseline, fresh, or
// upgrade; SQL_DSN/LOG_SQL_DSN select the databases, RC51_SQLITE_PATH and
// RC51_SQLITE_LOG_PATH select separate persistent SQLite files, and
// RC51_DB_MANIFEST stores the baseline catalog.
// The portable prefix also runs against the unmodified rc49 model package.
type rc51DatabaseCatalog struct {
	Indexes     []string
	Constraints []string
}

type rc51DatabaseManifest struct {
	Main rc51DatabaseCatalog
	Log  rc51DatabaseCatalog
}

func rc51OpenDatabase(t *testing.T) {
	t.Helper()
	if path := os.Getenv("RC51_SQLITE_PATH"); path != "" {
		common.SQLitePath = path
	}
	common.IsMasterNode = true
	common.RedisEnabled = false
	common.MemoryCacheEnabled = false
	common.DefaultLanguage = "en"
	require.NoError(t, InitDB())
	mainPath := common.SQLitePath
	if path := os.Getenv("RC51_SQLITE_LOG_PATH"); path != "" {
		common.SQLitePath = path
	}
	require.NoError(t, InitLogDB())
	common.SQLitePath = mainPath
	DB = DB.Session(&gorm.Session{Logger: logger.Discard})
	LOG_DB = LOG_DB.Session(&gorm.Session{Logger: logger.Discard})
	var version string
	if DB.Dialector.Name() == "sqlite" {
		require.NoError(t, DB.Raw("SELECT sqlite_version()").Scan(&version).Error)
	} else {
		require.NoError(t, DB.Raw("SELECT version()").Scan(&version).Error)
	}
	t.Logf("database=%s version=%s separate_log=%t", DB.Dialector.Name(), version, LOG_DB != DB)
}

func rc51Catalog(t *testing.T, db *gorm.DB) rc51DatabaseCatalog {
	t.Helper()
	var catalog rc51DatabaseCatalog
	switch db.Dialector.Name() {
	case "sqlite":
		require.NoError(t, db.Raw("SELECT tbl_name || ':' || name || ':' || COALESCE(sql, '') FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name, name").Scan(&catalog.Indexes).Error)
	case "mysql":
		require.NoError(t, db.Raw(`SELECT CONCAT(TABLE_NAME, ':', INDEX_NAME, ':', NON_UNIQUE, ':', GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`).Scan(&catalog.Indexes).Error)
		require.NoError(t, db.Raw(`SELECT CONCAT(TABLE_NAME, ':', CONSTRAINT_NAME, ':', CONSTRAINT_TYPE) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME`).Scan(&catalog.Constraints).Error)
	case "postgres":
		require.NoError(t, db.Raw(`SELECT tablename || ':' || indexname || ':' || indexdef FROM pg_indexes WHERE schemaname = current_schema() ORDER BY tablename, indexname`).Scan(&catalog.Indexes).Error)
		require.NoError(t, db.Raw(`SELECT rel.relname || ':' || con.conname || ':' || pg_get_constraintdef(con.oid) FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace ns ON ns.oid = rel.relnamespace WHERE ns.nspname = current_schema() ORDER BY rel.relname, con.conname`).Scan(&catalog.Constraints).Error)
	default:
		t.Fatal("unsupported integration test database")
	}
	return catalog
}

func rc51AssertCatalogPreserved(t *testing.T, before rc51DatabaseManifest) {
	t.Helper()
	for _, pair := range []struct {
		db      *gorm.DB
		catalog rc51DatabaseCatalog
	}{{DB, before.Main}, {LOG_DB, before.Log}} {
		after := rc51Catalog(t, pair.db)
		for _, index := range pair.catalog.Indexes {
			assert.Contains(t, after.Indexes, index, "existing index must survive migration")
		}
		for _, constraint := range pair.catalog.Constraints {
			assert.Contains(t, after.Constraints, constraint, "existing constraint must survive migration")
		}
	}
}

const rc51LegacyPrivate = `{"key":"fixture-key","upstream_task_id":"upstream-rc49","result_url":"https://example.invalid/result","plugin_state":{"cursor":"keep","nested":[1,false,"词"]},"poll_failures":2}`
const rc51LegacyProperties = `{"input":"preserved 词","upstream_model_name":"vendor-model","origin_model_name":"public-model"}`
const rc51ExistingInstances = `[{"id":"rp_keep","name":"Keep","plugin":"request-redact","enabled":true,"global":true,"groups":[],"models":[],"config":{"replacement":"[X]"}}]`
const rc51LegacyMarketplaceSources = `[{"name":"Old official AI","index_url":"https://plugins.newapi.ai/index.json"},{"name":"Old official Pro","index_url":"https://plugins.newapi.pro/index.json","kind":"official"},{"name":"Legacy custom 词","index_url":"https://plugins.example.invalid/index.json"}]`
const rc51LocalPluginSource = `export const meta = {apiVersion: 1, key: "rc51-local", name: "Offline local fixture", version: "1.0.0", author: {name: "CodeGuys"}};
export function ingress() { return {action: "continue", effects: [], findings: [{rule: "offline-local", count: 1}]}; }`

func rc51SeedDatabase(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Create(&User{Id: 510001, Username: "rc51-preserve", Password: "fixture-hash", AffCode: "rc51-aff", DisplayName: "Keep 词"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 510001, UserId: 510001, Key: "rc51-unique-token", Name: "Keep token"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 510001, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Name: "Keep channel", Key: `{"account":"rc49","token":"fixture-original"}`, Group: "default", Models: "public-model"}).Error)
	var task Task
	task.ID, task.TaskID, task.UserId, task.ChannelId = 510001, "task_rc49_preserved", 510001, 510001
	task.Platform, task.Status = constant.TaskPlatform("plugin"), TaskStatusQueued
	require.NoError(t, common.UnmarshalJsonStr(rc51LegacyPrivate, &task.PrivateData))
	require.NoError(t, common.UnmarshalJsonStr(rc51LegacyProperties, &task.Properties))
	task.SetData(map[string]any{"keep": "upstream snapshot", "ready": false})
	require.NoError(t, DB.Create(&task).Error)
	active := "rc51-preserve"
	require.NoError(t, DB.Create(&SystemTask{ID: 510001, TaskID: "systask_rc49_preserved", Type: "rc51-preserve", Status: SystemTaskStatusPending, ActiveKey: &active, Payload: `{"keep":"payload"}`, State: `{"keep":"state"}`}).Error)
	require.NoError(t, DB.Create(&TaskPlugin{Id: 510001, Key: "rc51-preserve", APIVersion: 1, Version: "1.0.0", Source: LongText("export const fixture = true;"), SourceHash: "fixture-source", Enabled: true, Active: true}).Error)
	require.NoError(t, DB.Create(&TaskPlugin{Id: 510002, Key: "rc51-local", APIVersion: 1, Version: "1.0.0", Source: LongText(rc51LocalPluginSource), SourceHash: "fixture-local-source", Enabled: true, Active: true}).Error)
	for key, value := range map[string]string{
		"CheckSensitiveEnabled": "true", "CheckSensitiveOnPromptEnabled": "true", "StopOnSensitiveEnabled": "false", "SensitiveWords": " Bad \n\n词\r\n", "StreamCacheQueueLength": "3",
		"request_plugin_setting.instances": rc51ExistingInstances, "rc51.keep": "untouched option 词",
		"TaskPluginMarketplaceSources": rc51LegacyMarketplaceSources,
	} {
		require.NoError(t, DB.Create(&Option{Key: key, Value: value}).Error)
	}
	require.NoError(t, LOG_DB.Create(&Log{Id: 510001, UserId: 510001, Type: LogTypeSystem, Content: "Keep audit 词", RequestId: "rc51-request", Other: `{"keep":true}`}).Error)
}

func rc51AssertLegacyData(t *testing.T) {
	t.Helper()
	var user User
	require.NoError(t, DB.First(&user, 510001).Error)
	assert.Equal(t, "rc51-preserve", user.Username)
	assert.Equal(t, "Keep 词", user.DisplayName)
	var token Token
	require.NoError(t, DB.First(&token, 510001).Error)
	assert.Equal(t, "rc51-unique-token", token.Key)
	var channel Channel
	require.NoError(t, DB.First(&channel, 510001).Error)
	assert.Equal(t, "Keep channel", channel.Name)
	assert.Equal(t, constant.ChannelTypeTaskPlugin, channel.Type)
	assert.Equal(t, "public-model", channel.Models)
	var task Task
	require.NoError(t, DB.First(&task, 510001).Error)
	private, err := common.Marshal(task.PrivateData)
	require.NoError(t, err)
	assert.JSONEq(t, rc51LegacyPrivate, string(private))
	properties, err := common.Marshal(task.Properties)
	require.NoError(t, err)
	assert.JSONEq(t, rc51LegacyProperties, string(properties))
	assert.JSONEq(t, `{"keep":"upstream snapshot","ready":false}`, string(task.Data))
	var systemTask SystemTask
	require.NoError(t, DB.First(&systemTask, 510001).Error)
	assert.Equal(t, "systask_rc49_preserved", systemTask.TaskID)
	assert.JSONEq(t, `{"keep":"payload"}`, systemTask.Payload)
	assert.JSONEq(t, `{"keep":"state"}`, systemTask.State)
	var plugin TaskPlugin
	require.NoError(t, DB.First(&plugin, 510001).Error)
	assert.Equal(t, LongText("export const fixture = true;"), plugin.Source)
	var option Option
	require.NoError(t, DB.Where(map[string]any{"key": "rc51.keep"}).First(&option).Error)
	assert.Equal(t, "untouched option 词", option.Value)
	var log Log
	require.NoError(t, LOG_DB.First(&log, 510001).Error)
	assert.Equal(t, "Keep audit 词", log.Content)
	assert.Equal(t, "rc51-request", log.RequestId)
	assert.JSONEq(t, `{"keep":true}`, log.Other)
}

func rc51AssertUniqueConstraints(t *testing.T) {
	t.Helper()
	// Use independent inserts: PostgreSQL aborts the current transaction after a
	// duplicate, so a transaction around these checks would hide later failures.
	assert.Error(t, DB.Create(&User{Username: "rc51-preserve", AffCode: "rc51-other"}).Error)
	assert.Error(t, DB.Create(&Token{UserId: 510001, Key: "rc51-unique-token"}).Error)
	assert.Error(t, DB.Create(&Option{Key: "rc51.keep", Value: "overwrite"}).Error)
	assert.Error(t, DB.Create(&SystemTask{TaskID: "systask_rc49_preserved", Type: "other"}).Error)
	active := "rc51-preserve"
	assert.Error(t, DB.Create(&SystemTask{TaskID: "systask_rc51_duplicate_active", Type: "other", ActiveKey: &active}).Error)
	assert.Error(t, DB.Create(&TaskPlugin{Key: "rc51-preserve", APIVersion: 1, Version: "1.0.0", Source: "other", SourceHash: "other"}).Error)
	assert.Error(t, DB.Model(&TaskPlugin{}).Where("id = ?", 510001).Update("source", nil).Error, "plugin source must remain NOT NULL")
}

func TestRC51DatabaseBaseline(t *testing.T) {
	if os.Getenv("RC51_DB_PHASE") != "baseline" {
		t.Skip("requires disposable baseline databases")
	}
	rc51OpenDatabase(t)
	rc51SeedDatabase(t)
	rc51AssertLegacyData(t)
	rc51AssertUniqueConstraints(t)
	manifest := rc51DatabaseManifest{Main: rc51Catalog(t, DB), Log: rc51Catalog(t, LOG_DB)}
	encoded, err := common.Marshal(manifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(os.Getenv("RC51_DB_MANIFEST"), encoded, 0600))
	require.NoError(t, CloseDB())
	rc51OpenDatabase(t)
	defer func() { require.NoError(t, CloseDB()) }()
	rc51AssertLegacyData(t)
	rc51AssertCatalogPreserved(t, manifest)
	t.Log("rc49 baseline: actual startup twice, seeded data and unique constraints preserved")
}

// RC51_CURRENT_ONLY: the rc49 harness is the portable prefix above this line.

func rc51AssertMarketplacePersistence(t *testing.T, instancesJSON string) {
	t.Helper()
	var legacy Option
	require.NoError(t, DB.Where(map[string]any{"key": setting.TaskPluginMarketplaceSourcesKey}).First(&legacy).Error)
	require.Equal(t, rc51LegacyMarketplaceSources, legacy.Value, "startup must retain the baseline source option")
	plugins, err := ListTaskPlugins()
	require.NoError(t, err)
	snapshot, err := GetTaskPluginSyncSnapshot()
	require.NoError(t, err)
	require.Len(t, snapshot.Plugins, 2)
	catalog := rc51DatabaseManifest{Main: rc51Catalog(t, DB), Log: rc51Catalog(t, LOG_DB)}
	legacyCustom := []setting.TaskPluginMarketplaceSource{{Name: "Legacy custom 词", IndexURL: "https://plugins.example.invalid/index.json", Kind: setting.TaskPluginMarketplaceKindThirdParty}}
	explicitSources := []setting.TaskPluginMarketplaceSource{
		{Name: "CodeGuys trusted 词", IndexURL: "https://plugins.codeguys.example.invalid/index.json", Kind: setting.TaskPluginMarketplaceKindOfficial},
		{Name: "Third party", IndexURL: "https://third.example.invalid/index.json", Kind: setting.TaskPluginMarketplaceKindThirdParty},
		{Name: "Community", IndexURL: "https://community.example.invalid/index.json", Kind: setting.TaskPluginMarketplaceKindCommunity},
	}
	encodedSources, err := common.Marshal(explicitSources)
	require.NoError(t, err)
	switches := []struct {
		key     string
		enabled func() bool
	}{
		{setting.TaskPluginCommunityEnabledKey, setting.IsTaskPluginCommunityEnabled},
		{setting.TaskPluginMarketplaceShortCodesEnabledKey, setting.IsTaskPluginMarketplaceShortCodesEnabled},
		{setting.TaskPluginMarketplaceInstallStatsEnabledKey, setting.IsTaskPluginMarketplaceInstallStatsEnabled},
		{setting.TaskPluginMarketplaceRemoteRevocationsEnabledKey, setting.IsTaskPluginMarketplaceRemoteRevocationsEnabled},
	}
	keys := []string{setting.TaskPluginMarketplaceSourcesKey}
	for _, feature := range switches {
		keys = append(keys, feature.key)
	}
	cases := []struct {
		name    string
		raw     string
		missing bool
		enabled bool
		want    []setting.TaskPluginMarketplaceSource
	}{
		{name: "baseline_legacy_sources", raw: rc51LegacyMarketplaceSources, want: legacyCustom},
		{name: "missing_options", missing: true, want: []setting.TaskPluginMarketplaceSource{}},
		{name: "persisted_blank", raw: "", want: []setting.TaskPluginMarketplaceSource{}},
		{name: "persisted_empty_array", raw: "[]", want: []setting.TaskPluginMarketplaceSource{}},
		{name: "legacy_without_kind", raw: `[{"name":"Legacy custom 词","index_url":"https://plugins.example.invalid/index.json"}]`, want: legacyCustom},
		{name: "legacy_official_only", raw: `[{"name":"AI","index_url":"https://newapi.ai/index.json","kind":"official"},{"name":"Pro","index_url":"https://newapi.pro/index.json"},{"name":"AI subdomain","index_url":"https://plugins.newapi.ai/index.json"},{"name":"Pro subdomain","index_url":"https://plugins.newapi.pro/index.json","kind":"community"},{"name":"GitHub","index_url":"https://github.com/QuantumNous/new-api-plugins/index.json"},{"name":"Raw GitHub","index_url":"https://raw.githubusercontent.com/QuantumNous/new-api-plugins/main/index.json"}]`, want: []setting.TaskPluginMarketplaceSource{}},
		{name: "explicit_trust_with_features_off", raw: string(encodedSources), want: explicitSources},
		{name: "explicit_feature_opt_in", raw: string(encodedSources), enabled: true, want: explicitSources},
		{name: "disable_after_opt_in", raw: "[]", want: []setting.TaskPluginMarketplaceSource{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.missing {
				require.NoError(t, DB.Where(map[string]any{"key": keys}).Delete(&Option{}).Error)
			} else if tc.name != "baseline_legacy_sources" {
				values := map[string]string{setting.TaskPluginMarketplaceSourcesKey: tc.raw}
				for _, feature := range switches {
					values[feature.key] = "false"
					if tc.enabled {
						values[feature.key] = "true"
					}
				}
				require.NoError(t, UpdateOptionsBulk(values))
			}
			revisions, err := GetLatestSyncRevisions()
			require.NoError(t, err)
			for boot := range 2 {
				require.NoError(t, CloseDB())
				rc51OpenDatabase(t)
				InitOptionMap()
				assert.Equal(t, tc.want, setting.GetTaskPluginMarketplaceSources(), "boot %d: no implicit source or legacy fallback", boot+1)
				for _, source := range tc.want {
					assert.Equal(t, source.Kind, setting.TaskPluginMarketplaceSourceKind(source.IndexURL))
				}
				assert.Equal(t, setting.TaskPluginMarketplaceKindThirdParty, setting.TaskPluginMarketplaceSourceKind("https://plugins.newapi.ai/index.json"))
				common.OptionMapRWMutex.RLock()
				loaded := make(map[string]string, len(keys))
				for _, key := range keys {
					loaded[key] = common.OptionMap[key]
				}
				common.OptionMapRWMutex.RUnlock()
				for _, feature := range switches {
					assert.Equal(t, tc.enabled, feature.enabled(), "boot %d: %s", boot+1, feature.key)
					want := "false"
					if tc.enabled {
						want = "true"
					}
					assert.Equal(t, want, loaded[feature.key], "missing options must initialize to explicit false")
					var stored Option
					err := DB.Where(map[string]any{"key": feature.key}).First(&stored).Error
					if tc.missing || tc.name == "baseline_legacy_sources" {
						assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "defaults need not write rows")
					} else {
						require.NoError(t, err)
						assert.Equal(t, want, stored.Value)
					}
				}
				var stored Option
				err = DB.Where(map[string]any{"key": setting.TaskPluginMarketplaceSourcesKey}).First(&stored).Error
				if tc.missing {
					assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
					assert.Equal(t, "[]", loaded[setting.TaskPluginMarketplaceSourcesKey])
				} else {
					require.NoError(t, err)
					assert.Equal(t, tc.raw, stored.Value, "source filtering must not rewrite persisted administrator data")
					assert.Equal(t, tc.raw, loaded[setting.TaskPluginMarketplaceSourcesKey])
				}
				reloaded, err := ListTaskPlugins()
				require.NoError(t, err)
				assert.Equal(t, plugins, reloaded, "market settings must not delete or disable installed plugins")
				after, err := GetTaskPluginSyncSnapshot()
				require.NoError(t, err)
				assert.Equal(t, snapshot, after, "local plugin sync must remain available")
				stored = Option{}
				require.NoError(t, DB.Where(map[string]any{"key": request_plugin_setting.InstancesOption}).First(&stored).Error)
				assert.JSONEq(t, instancesJSON, stored.Value, "market settings must retain request instances")
				runtimeInstances, err := common.Marshal(request_plugin_setting.GetInstances())
				require.NoError(t, err)
				assert.JSONEq(t, instancesJSON, string(runtimeInstances), "request instances must load with the market disabled")
				afterRevisions, err := GetLatestSyncRevisions()
				require.NoError(t, err)
				assert.Equal(t, revisions, afterRevisions, "initialization must not enqueue sync writes")
				assert.Equal(t, catalog.Main, rc51Catalog(t, DB), "main migration must remain idempotent")
				assert.Equal(t, catalog.Log, rc51Catalog(t, LOG_DB), "independent log migration must remain idempotent")
			}
		})
	}
	local, err := GetTaskPluginVersion("rc51-local", "1.0.0")
	require.NoError(t, err)
	plugin, err := jsplugin.CompilePlugin(string(local.Source), jsplugin.Options{})
	require.NoError(t, err)
	result, err := plugin.CallTransform(context.Background(), jsplugin.TransformContext{Stage: "ingress", Format: "openai", Model: "fixture"}, jsplugin.TransformRequest{Body: []byte(`{"model":"fixture"}`)})
	require.NoError(t, err)
	assert.Equal(t, "continue", result.Action, "locally installed plugin must run with no marketplace sources or features")
	require.Len(t, result.Findings, 1)
	assert.Equal(t, "offline-local", result.Findings[0].Rule)
	t.Log("marketplace persistence: legacy/missing/blank/empty/explicit sources, four false defaults, explicit opt-in then disable, two actual startups per case; plugin rows/sync/request instances retained and local JS executed offline")
}

func TestRC51DatabaseIntegration(t *testing.T) {
	phase := os.Getenv("RC51_DB_PHASE")
	if phase != "fresh" && phase != "upgrade" {
		t.Skip("requires disposable rc51 databases")
	}
	var before rc51DatabaseManifest
	if phase == "upgrade" {
		encoded, err := os.ReadFile(os.Getenv("RC51_DB_MANIFEST"))
		require.NoError(t, err)
		require.NoError(t, common.Unmarshal(encoded, &before))
	}
	rc51OpenDatabase(t)
	if phase == "fresh" {
		rc51SeedDatabase(t)
		before = rc51DatabaseManifest{Main: rc51Catalog(t, DB), Log: rc51Catalog(t, LOG_DB)}
	}
	rc51AssertLegacyData(t)
	rc51AssertCatalogPreserved(t, before)
	rc51AssertUniqueConstraints(t)
	require.NoError(t, MigrateSensitiveWords())
	var migrated Option
	require.NoError(t, DB.Where(map[string]any{"key": "request_plugin_setting.instances"}).First(&migrated).Error)
	var instances []map[string]any
	require.NoError(t, common.UnmarshalJsonStr(migrated.Value, &instances))
	require.Len(t, instances, 2)
	keep, err := common.Marshal(instances[:1])
	require.NoError(t, err)
	assert.JSONEq(t, rc51ExistingInstances, string(keep))
	assert.Equal(t, "request-filter", instances[1]["plugin"])
	assert.Equal(t, true, instances[1]["enabled"])
	assert.Equal(t, true, instances[1]["global"])
	config, err := common.Marshal(instances[1]["config"])
	require.NoError(t, err)
	assert.JSONEq(t, `{"rules":[],"keywords":"Bad\n词","keywordsCaseSensitive":false,"message":"","replies":false}`, string(config))
	for _, key := range retiredSensitiveOptionKeys {
		var count int64
		require.NoError(t, DB.Model(&Option{}).Where(map[string]any{"key": key}).Count(&count).Error)
		assert.Zero(t, count, key)
	}
	revisions, err := GetLatestSyncRevisions()
	require.NoError(t, err)
	assert.NotZero(t, revisions[SyncTopicOptions])

	// The new credential may be the only private field. It must never become
	// SQL NULL, including when PostgreSQL uses the real simple-protocol DSN.
	privateCases := []struct {
		name string
		json string
	}{
		{"credential_only", `{"credential_account":"account-词"}`},
		{"request_plugin_only", `{"request_plugins":{"instances":["rp_keep"],"format":"openai","started_at":1700000000123}}`},
		{"plugin_full", `{"key":"fixture-private","upstream_task_id":"vendor-51","credential_account":"account-词","execution":{"request_id":"req-51","request_path":"/v1/responses","task_plugin":{"key":"fixture","name":"Fixture","version":"1.0.0","api_version":1,"generation":2}},"plugin_state":{"next":[false,0,"词"]},"request_plugins":{"instances":["rp_keep"],"format":"openai","attempt":2,"started_at":1700000000123,"request":{"input":"keep"}}}`},
	}
	for i, tc := range privateCases {
		t.Run(tc.name, func(t *testing.T) {
			task := Task{ID: int64(510010 + i), TaskID: "task_rc51_" + tc.name, Status: TaskStatusQueued}
			require.NoError(t, common.UnmarshalJsonStr(tc.json, &task.PrivateData))
			require.NoError(t, DB.Create(&task).Error)
			var saved Task
			require.NoError(t, DB.First(&saved, task.ID).Error)
			actual, err := common.Marshal(saved.PrivateData)
			require.NoError(t, err)
			assert.JSONEq(t, tc.json, string(actual))
			public, err := common.Marshal(saved)
			require.NoError(t, err)
			assert.NotContains(t, string(public), "credential_account")
			assert.NotContains(t, string(public), "fixture-private")
		})
	}

	t.Run("credential_update_transaction", func(t *testing.T) {
		_, err := UpdateChannelLocked(510001, func(channel *Channel) error {
			assert.JSONEq(t, `{"account":"rc49","token":"fixture-original"}`, channel.Key, "upgrade must preserve the existing credential")
			channel.Key = `{"account":"account-词","token":"fixture-refreshed"}`
			return nil
		})
		require.NoError(t, err)
		failure := errors.New("fixture rejected update")
		_, err = UpdateChannelLocked(510001, func(channel *Channel) error {
			channel.Key = "must-roll-back"
			return failure
		})
		assert.ErrorIs(t, err, failure)
		var channel Channel
		require.NoError(t, DB.First(&channel, 510001).Error)
		assert.JSONEq(t, `{"account":"account-词","token":"fixture-refreshed"}`, channel.Key)
	})

	t.Run("sync_commit_and_rollback", func(t *testing.T) {
		require.NoError(t, DB.Transaction(func(tx *gorm.DB) error { return bumpSyncTopic(tx, SyncTopicPlugins) }))
		first, err := GetLatestSyncRevisions()
		require.NoError(t, err)
		require.NotZero(t, first[SyncTopicPlugins])
		rollback := errors.New("rollback fixture")
		err = DB.Transaction(func(tx *gorm.DB) error {
			if err := bumpSyncTopic(tx, SyncTopicPlugins); err != nil {
				return err
			}
			return rollback
		})
		require.ErrorIs(t, err, rollback)
		after, err := GetLatestSyncRevisions()
		require.NoError(t, err)
		assert.Equal(t, first[SyncTopicPlugins], after[SyncTopicPlugins])
	})

	// Invalid saved plugin JSON must keep the retired options intact. A fixed
	// list can be retried, and an already converted list must not gain duplicates.
	t.Run("sensitive_word_rollback", func(t *testing.T) {
		require.NoError(t, DB.Model(&Option{}).Where(map[string]any{"key": migrated.Key}).Update("value", "{").Error)
		require.NoError(t, DB.Create(&Option{Key: "SensitiveWords", Value: "rollback-word"}).Error)
		require.Error(t, MigrateSensitiveWords())
		var words Option
		require.NoError(t, DB.Where(map[string]any{"key": "SensitiveWords"}).First(&words).Error)
		assert.Equal(t, "rollback-word", words.Value)
		require.NoError(t, DB.Delete(&Option{Key: "SensitiveWords"}).Error)
		require.NoError(t, DB.Model(&Option{}).Where(map[string]any{"key": migrated.Key}).Update("value", migrated.Value).Error)
	})

	t.Run("marketplace_persistence", func(t *testing.T) {
		rc51AssertMarketplacePersistence(t, migrated.Value)
	})

	stable := rc51DatabaseManifest{Main: rc51Catalog(t, DB), Log: rc51Catalog(t, LOG_DB)}
	stableRevisions, err := GetLatestSyncRevisions()
	require.NoError(t, err)
	require.NoError(t, CloseDB())
	rc51OpenDatabase(t)
	defer func() { require.NoError(t, CloseDB()) }()
	require.NoError(t, MigrateSensitiveWords())
	rc51AssertLegacyData(t)
	rc51AssertUniqueConstraints(t)
	rc51AssertCatalogPreserved(t, before)
	assert.Equal(t, stable.Main, rc51Catalog(t, DB), "second startup must keep the same schema")
	assert.Equal(t, stable.Log, rc51Catalog(t, LOG_DB), "separate log migration must be idempotent")
	var saved Option
	require.NoError(t, DB.Where(map[string]any{"key": migrated.Key}).First(&saved).Error)
	assert.Equal(t, migrated.Value, saved.Value, "second migration must not append another filter")
	afterRevisions, err := GetLatestSyncRevisions()
	require.NoError(t, err)
	assert.Equal(t, stableRevisions, afterRevisions, "second startup must not add sync work")
	for i, tc := range privateCases {
		var saved Task
		require.NoError(t, DB.First(&saved, 510010+i).Error)
		actual, err := common.Marshal(saved.PrivateData)
		require.NoError(t, err)
		assert.JSONEq(t, tc.json, string(actual), "private data survives reopen")
	}
	var channel Channel
	require.NoError(t, DB.First(&channel, 510001).Error)
	assert.JSONEq(t, `{"account":"account-词","token":"fixture-refreshed"}`, channel.Key)
	indexes := stable.Main.Indexes
	assert.True(t, slices.ContainsFunc(indexes, func(index string) bool {
		return strings.Contains(index, "system_tasks:idx_system_tasks_type_id:") && (strings.Contains(index, "type,id") || strings.Contains(index, "(type, id)") || strings.Contains(index, "(`type`,`id`)") || strings.Contains(index, "(`type`, `id`)"))
	}), "system_tasks must have the ordered (type,id) composite index: %v", indexes)
	var latest SystemTask
	require.NoError(t, DB.WithContext(context.Background()).Where("type = ?", SyncTaskType(SyncTopicPlugins)).Order("id DESC").First(&latest).Error)
	assert.Equal(t, afterRevisions[SyncTopicPlugins], latest.ID)
	t.Logf("%s: actual startup twice; legacy data/catalog/uniqueness, filter migration, sync commit/rollback and private JSON/credential persistence passed", phase)
}
