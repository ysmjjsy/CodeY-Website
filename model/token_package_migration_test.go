package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestTokenPackageMigrationsAreStable runs the marketplace schema through
// AutoMigrate twice. The second pass must be a no-op, which is what makes a
// fresh install and an upgrade converge on the same schema.
func TestTokenPackageMigrationsAreStable(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			runTokenPackageMigrationOnce(t, dialect)
		})
	}
}

func runTokenPackageMigrationOnce(t *testing.T, dialect string) {
	t.Helper()
	var dsn string
	switch dialect {
	case "sqlite":
		dsn = "local"
		previousPath := common.SQLitePath
		common.SQLitePath = filepath.Join(t.TempDir(), "package.db")
		t.Cleanup(func() { common.SQLitePath = previousPath })
	case "mysql":
		dsn = os.Getenv("TEST_MYSQL_DSN")
	case "postgres":
		dsn = os.Getenv("TEST_POSTGRES_DSN")
	}
	if dsn == "" {
		t.Skip("test database DSN is not configured")
	}
	t.Setenv("MIGRATION_TEST_DSN", dsn)
	db, _, err := chooseDB("MIGRATION_TEST_DSN", false)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	models := []any{
		&Channel{},
		&Token{},
		&User{},
		&UserVerification{},
		&SellerProfile{},
		&TokenPackage{},
		&TokenPackageVersion{},
		&TokenPackageChannel{},
		&TokenPackageOrder{},
		&TokenPackageEntitlement{},
		&TokenPackagePreconsumeRecord{},
		&SellerLedgerEntry{},
	}
	require.NoError(t, db.AutoMigrate(models...))

	recorder := &migrationSQLRecorder{}
	second := db.Session(&gorm.Session{Logger: recorder})
	require.NoError(t, second.AutoMigrate(models...))
	assert.Empty(t, recorder.schemaMutations(), "the second migration must not change the schema")

	assert.True(t, db.Migrator().HasColumn(&TokenPackage{}, "active_version_id"))
	assert.True(t, db.Migrator().HasColumn(&TokenPackageEntitlement{}, "seller_quota_released"))
	assert.True(t, db.Migrator().HasColumn(&TokenPackagePreconsumeRecord{}, "request_id"))
	assert.True(t, db.Migrator().HasColumn(&SellerLedgerEntry{}, "available_at"))
	assert.True(t, db.Migrator().HasIndex(&TokenPackageVersion{}, "idx_token_package_version_no"))
	assert.True(t, db.Migrator().HasIndex(&TokenPackageChannel{}, "idx_token_package_version_channel"))
	_ = common.GetTimestamp()
}
