package model

import (
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// legacySystemNames are the brand names this project used before CodeGuys.
// A stored SystemName that is exactly one of these, ignoring case and the
// surrounding space, is the default that was never chosen, so it is corrected.
// Anything else was set on purpose and is left as it is.
var legacySystemNames = []string{"codeguys", "new-api", "new api", "newapi"}

func migrateLegacySystemName(db *gorm.DB) error {
	if db == nil || !db.Migrator().HasTable(&Option{}) {
		return nil
	}
	var stored Option
	err := db.Where(Option{Key: "SystemName"}).First(&stored).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	if err != nil {
		return err
	}
	if !isLegacySystemName(stored.Value) {
		return nil
	}
	return db.Model(&Option{}).
		Where(Option{Key: "SystemName"}).
		Update("value", common.SystemName).Error
}

func isLegacySystemName(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	for _, legacy := range legacySystemNames {
		if normalized == legacy {
			return true
		}
	}
	return false
}
