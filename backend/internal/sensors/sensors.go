// Package sensors judges whether soil-moisture readings can be trusted.
// The irrigation engine acts on telemetry, so a stuck or jumping probe could
// flood a field or leave it dry; zones flagged here are excluded from automatic watering decisions and raise an alert.
//
// Analyze is pure (readings in, verdicts out); Faults is the thin database
// shell the engine and alerts share.
package sensors

import (
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

const (
	// Window is how far back readings are examined.
	Window = 6 * time.Hour
	// stuckMinReadings / stuckMinSpan: the same value (within stuckEpsilon)
	// for at least this many readings spread over at least this long.
	stuckMinReadings = 12
	stuckMinSpan     = 2 * time.Hour
	stuckEpsilon     = 0.05
	// maxJump is the largest plausible change between two consecutive
	// readings taken minutes apart (percentage points).
	maxJump = 40.0
	// jumpMaxGap: jumps across a longer gap are not counted (real weather or
	// watering can move soil a lot over hours).
	jumpMaxGap = 30 * time.Minute
)

// Reading is one telemetry sample's per-zone moisture.
type Reading struct {
	Ts           time.Time
	SoilMoisture []float64
}

// Fault describes why a zone's sensor is distrusted.
type Fault struct {
	Zone   int
	Reason string
}

// Analyze checks each zone over the readings (any order) and returns one
// Fault per distrusted zone, ordered by zone.
func Analyze(readings []Reading) []Fault {
	rs := append([]Reading(nil), readings...)
	sort.Slice(rs, func(i, j int) bool { return rs[i].Ts.Before(rs[j].Ts) })

	zones := 0
	for _, r := range rs {
		if len(r.SoilMoisture) > zones {
			zones = len(r.SoilMoisture)
		}
	}
	var faults []Fault
	for z := 0; z < zones; z++ {
		if reason := zoneFault(rs, z); reason != "" {
			faults = append(faults, Fault{Zone: z, Reason: reason})
		}
	}
	return faults
}

func zoneFault(rs []Reading, z int) string {
	// impossible values and sudden jumps
	var prev *Reading
	for i := range rs {
		r := &rs[i]
		if z >= len(r.SoilMoisture) {
			continue
		}
		v := r.SoilMoisture[z]
		if v < 0 || v > 100 {
			return fmt.Sprintf("অসম্ভব মান (%.0f%%)", v)
		}
		if prev != nil && r.Ts.Sub(prev.Ts) <= jumpMaxGap {
			if d := v - prev.SoilMoisture[z]; d > maxJump || d < -maxJump {
				return fmt.Sprintf("হঠাৎ লাফ (%.0f%% → %.0f%%)", prev.SoilMoisture[z], v)
			}
		}
		prev = r
	}
	// stuck: the trailing run of (nearly) identical values
	var run []time.Time
	var last float64
	for i := len(rs) - 1; i >= 0; i-- {
		if z >= len(rs[i].SoilMoisture) {
			continue
		}
		v := rs[i].SoilMoisture[z]
		if len(run) == 0 {
			last = v
		} else if v-last > stuckEpsilon || last-v > stuckEpsilon {
			break
		}
		run = append(run, rs[i].Ts)
	}
	if len(run) >= stuckMinReadings && run[0].Sub(run[len(run)-1]) >= stuckMinSpan {
		return fmt.Sprintf("একই মান (%.1f%%) অনেকক্ষণ আটকে আছে", last)
	}
	return ""
}

// Faults loads the farm's recent telemetry and analyzes it. A farm with no
// recent telemetry (simulated, or devices offline) reports no faults —
// offline devices have their own alert.
func Faults(db *gorm.DB, farm *models.Farm, now time.Time) []Fault {
	var rows []models.Telemetry
	if err := db.Where("farm_slug = ? AND ts >= ?", farm.Slug, now.Add(-Window)).
		Order("ts").Find(&rows).Error; err != nil {
		return nil
	}
	readings := make([]Reading, len(rows))
	for i, r := range rows {
		readings[i] = Reading{Ts: r.Ts, SoilMoisture: r.SoilMoisture}
	}
	return Analyze(readings)
}

// FaultyMask turns faults into a per-zone bool slice of length zones.
func FaultyMask(faults []Fault, zones int) []bool {
	mask := make([]bool, zones)
	for _, f := range faults {
		if f.Zone < zones {
			mask[f.Zone] = true
		}
	}
	return mask
}

// Validate rejects physically impossible telemetry at ingest.
func Validate(airTemp, airHumidity, tankLevel, batteryV float64) error {
	switch {
	case airTemp < -40 || airTemp > 85:
		return fmt.Errorf("air_temp %.1f সীমার বাইরে (-৪০..৮৫)", airTemp)
	case airHumidity < 0 || airHumidity > 100:
		return fmt.Errorf("air_humidity %.1f সীমার বাইরে (০..১০০)", airHumidity)
	case tankLevel < 0 || tankLevel > 100:
		return fmt.Errorf("tank_level %.1f সীমার বাইরে (০..১০০)", tankLevel)
	case batteryV < 0 || batteryV > 60:
		return fmt.Errorf("battery_v %.1f সীমার বাইরে (০..৬০)", batteryV)
	}
	return nil
}
