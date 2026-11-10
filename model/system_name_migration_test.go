package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// A stored system name from before the CodeGuys rename is the old default, so
// startup corrects it. A name someone set on purpose is left as it is, and a
// second run changes nothing.
func TestMigrateLegacySystemName(t *testing.T) {
	db := openSystemNameDB(t)
	require.NoError(t, db.Create(&Option{Key: "SystemName", Value: "codeguys"}).Error)

	require.NoError(t, migrateLegacySystemName(db))
	assert.Equal(t, "CodeGuys", storedSystemName(t, db))

	require.NoError(t, migrateLegacySystemName(db))
	assert.Equal(t, "CodeGuys", storedSystemName(t, db))
}

func TestMigrateLegacySystemNameKeepsAChosenName(t *testing.T) {
	for _, chosen := range []string{"My Gateway", "codeguys cloud", "CodeGuys Pro"} {
		t.Run(chosen, func(t *testing.T) {
			db := openSystemNameDB(t)
			require.NoError(t, db.Create(&Option{Key: "SystemName", Value: chosen}).Error)

			require.NoError(t, migrateLegacySystemName(db))
			assert.Equal(t, chosen, storedSystemName(t, db))
		})
	}
}

func TestMigrateLegacySystemNameRecognizesEarlierBrands(t *testing.T) {
	for _, legacy := range []string{" New API ", "new-api", "NewAPI"} {
		t.Run(legacy, func(t *testing.T) {
			db := openSystemNameDB(t)
			require.NoError(t, db.Create(&Option{Key: "SystemName", Value: legacy}).Error)

			require.NoError(t, migrateLegacySystemName(db))
			assert.Equal(t, "CodeGuys", storedSystemName(t, db))
		})
	}
}

func TestMigrateLegacySystemNameWithoutAStoredName(t *testing.T) {
	db := openSystemNameDB(t)

	require.NoError(t, migrateLegacySystemName(db))

	var count int64
	require.NoError(t, db.Model(&Option{}).Where(Option{Key: "SystemName"}).Count(&count).Error)
	assert.Equal(t, int64(0), count)
}

func openSystemNameDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	return db
}

func storedSystemName(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var stored Option
	require.NoError(t, db.Where(Option{Key: "SystemName"}).First(&stored).Error)
	return stored.Value
}
