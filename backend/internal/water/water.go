// Package water keeps the pump's water account: every
// stretch the pump runs becomes a PumpRun with litres = minutes × the farm's
// measured flow. Together with harvests this yields litres per kg — the
// number that shows whether "less water, same yield" is actually happening.
package water

import (
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// Litres converts a run length to litres at flowLpm litres/minute.
func Litres(startMs, endMs int64, flowLpm float64) float64 {
	if endMs <= startMs || flowLpm <= 0 {
		return 0
	}
	return float64(endMs-startMs) / 60_000 * flowLpm
}

// OpenZones lists the indexes of open valves.
func OpenZones(valves []bool) []int {
	zones := []int{}
	for i, open := range valves {
		if open {
			zones = append(zones, i)
		}
	}
	return zones
}

// Sync reconciles the run table with farm.PumpOn. It is idempotent, so the
// engine calls it every tick and the API after each hand pump change: a
// running pump with no open run opens one; a stopped pump closes any open
// run, stamping its litres.
func Sync(db *gorm.DB, farm *models.Farm, now time.Time) {
	// Find (not First): "no open run" is the normal case, not a "record not found" error to log
	var found []models.PumpRun
	if err := db.Where("farm_id = ? AND \"end\" = 0 AND source = ?", farm.ID, "pump").
		Order("start desc").Limit(1).Find(&found).Error; err != nil {
		log.Printf("water: looking up open run for %s: %v", farm.ID, err)
		return
	}
	hasOpen := len(found) > 0
	var open models.PumpRun
	if hasOpen {
		open = found[0]
	}

	switch {
	case farm.PumpOn && !hasOpen:
		run := models.PumpRun{
			FarmID: farm.ID, Start: now.UnixMilli(),
			Zones: OpenZones(farm.Valves), Source: "pump",
		}
		if err := db.Create(&run).Error; err != nil {
			log.Printf("water: opening run for %s: %v", farm.ID, err)
		}
	case !farm.PumpOn && hasOpen:
		end := now.UnixMilli()
		if end <= open.Start {
			end = open.Start + 1
		}
		if err := db.Model(&open).Updates(map[string]any{
			"end": end, "litres": Litres(open.Start, end, farm.PumpFlowLpm),
		}).Error; err != nil {
			log.Printf("water: closing run for %s: %v", farm.ID, err)
		}
	}
}

// Burst records a fixed-length watering that has no relay on/off trace (the
// manual water button, a schedule firing) as an already-closed run.
func Burst(db *gorm.DB, farm *models.Farm, zones []int, minutes int, source string, now time.Time) {
	if minutes <= 0 || len(zones) == 0 {
		return
	}
	end := now.UnixMilli()
	start := end - int64(minutes)*60_000
	run := models.PumpRun{
		FarmID: farm.ID, Start: start, End: end, Zones: zones, Source: source,
		Litres: Litres(start, end, farm.PumpFlowLpm),
	}
	if err := db.Create(&run).Error; err != nil {
		log.Printf("water: recording %s burst for %s: %v", source, farm.ID, err)
	}
}

// ZoneLitres splits runs' litres equally across each run's zones.
func ZoneLitres(runs []models.PumpRun, zones int) []float64 {
	out := make([]float64, zones)
	for _, r := range runs {
		if len(r.Zones) == 0 {
			continue
		}
		share := r.Litres / float64(len(r.Zones))
		for _, z := range r.Zones {
			if z >= 0 && z < zones {
				out[z] += share
			}
		}
	}
	return out
}

// FieldEfficiency is the water-use verdict for one field over a period.
type FieldEfficiency struct {
	FieldID string  `json:"fieldId"`
	Name    string  `json:"name"`
	Crop    string  `json:"crop"`
	Zone    *int    `json:"zone,omitempty"`
	Litres  float64 `json:"litres"`
	Kg      float64 `json:"kg"`
	// LitresPerKg is nil until there is both water and a harvest.
	LitresPerKg *float64 `json:"litresPerKg"`
	Revenue     float64  `json:"revenue"`
}

// Efficiency joins water use and harvests per field. A zone's litres are
// split equally between the fields linked to it; fields with no zone get no
// water attributed.
func Efficiency(fields []models.Field, runs []models.PumpRun, harvests []models.Harvest, zones int) []FieldEfficiency {
	perZone := ZoneLitres(runs, zones)
	fieldsInZone := map[int]int{}
	for _, f := range fields {
		if f.Zone != nil {
			fieldsInZone[*f.Zone]++
		}
	}
	kg := map[string]float64{}
	revenue := map[string]float64{}
	for _, h := range harvests {
		kg[h.FieldID] += h.Kg
		revenue[h.FieldID] += h.Kg * h.PricePerKg
	}
	out := make([]FieldEfficiency, 0, len(fields))
	for _, f := range fields {
		e := FieldEfficiency{FieldID: f.ID, Name: f.Name, Crop: f.Crop, Zone: f.Zone,
			Kg: kg[f.ID], Revenue: revenue[f.ID]}
		if f.Zone != nil && *f.Zone >= 0 && *f.Zone < zones {
			e.Litres = perZone[*f.Zone] / float64(fieldsInZone[*f.Zone])
		}
		if e.Litres > 0 && e.Kg > 0 {
			v := e.Litres / e.Kg
			e.LitresPerKg = &v
		}
		out = append(out, e)
	}
	return out
}

// MinutesToday is how long the pump has run since local midnight (Dhaka),
// counting finished runs and a still-open one up to now. Fixed-minute
// waterings (source manual/schedule) count with their recorded length.
func MinutesToday(db *gorm.DB, farmID string, now time.Time) float64 {
	local := now.In(models.FarmZone)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, models.FarmZone).UnixMilli()
	var runs []models.PumpRun
	if err := db.Where("farm_id = ? AND (\"end\" = 0 OR \"end\" > ?)", farmID, dayStart).Find(&runs).Error; err != nil {
		log.Printf("water: minutes today for %s: %v", farmID, err)
		return 0
	}
	nowMs := now.UnixMilli()
	var ms int64
	for _, r := range runs {
		start, end := r.Start, r.End
		if end == 0 {
			end = nowMs
		}
		if start < dayStart {
			start = dayStart
		}
		if end > start {
			ms += end - start
		}
	}
	return float64(ms) / 60_000
}
