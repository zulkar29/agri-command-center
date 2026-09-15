// Package pump holds the one implementation of "the pump changed state" that
// the REST handlers and the irrigation engine share: updating the relay
// device row (and, for hand control, the farm row, log line and water
// account). When the MQTT bridge arrives (docs/05) this is the single place
// that will publish the command to the device.
package pump

import (
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/water"
)

// ManualLogText is the irrigation-log line for a hand-driven pump change.
func ManualLogText(on bool) string {
	if on {
		return "পাম্প হাতে চালু"
	}
	return "পাম্প হাতে বন্ধ"
}

// SetManual drives the pump by hand: pump on/off, mode switches to manual,
// the engine's Duration timer is forgotten (hand runs are not time-limited),
// the relay row follows, a log line is written and the water account is
// reconciled. farm is updated in place. Returns the log text.
func SetManual(db *gorm.DB, farm *models.Farm, on bool, now time.Time) (string, error) {
	err := db.Model(farm).Updates(map[string]any{
		"pump_on": on, "mode": "manual", "pump_since": nil,
	}).Error
	if err != nil {
		return "", err
	}
	farm.PumpOn, farm.Mode, farm.PumpSince = on, "manual", nil

	text := ManualLogText(on)
	if err := db.Create(&models.LogEntry{FarmID: farm.ID, At: now.UnixMilli(), Text: text}).Error; err != nil {
		return "", err
	}
	SyncRelay(db, farm.ID, on, now)
	water.Sync(db, farm, now)
	return text, nil
}

// SyncRelay mirrors the farm's pump state onto its relay device row (the
// metrics the devices page shows). A farm without a relay row is fine.
func SyncRelay(db *gorm.DB, farmID string, on bool, now time.Time) {
	var relay models.Device
	if err := db.Where("farm_id = ? AND kind = ?", farmID, "relay").First(&relay).Error; err != nil {
		return
	}
	if relay.Metrics == nil {
		relay.Metrics = map[string]float64{}
	}
	state := 0.0
	if on {
		state = 1
	}
	if relay.Metrics["state"] != state {
		// a measured current belonged to the old state; keep none until the
		// relay reports again, so "on with no current" is never a stale reading
		delete(relay.Metrics, "current_a")
	}
	relay.Metrics["state"] = state
	relay.Online = true
	relay.LastSeenAt = now.UnixMilli()
	if err := db.Save(&relay).Error; err != nil {
		log.Printf("pump: saving relay for %s: %v", farmID, err)
	}
}
