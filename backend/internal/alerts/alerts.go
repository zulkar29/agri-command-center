// Package alerts moves the alert logic server-side: the
// same conditions the clients derived locally — dry zones, low tank, high
// humidity, low stock — plus two that only a server can watch (low battery,
// device offline). The engine evaluates every tick and upserts Alert rows,
// so a warning survives app restarts, is acked once and notifies once per
// activation instead of on every poll.
package alerts

import (
	"fmt"
	"log"
	"math"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/bangla"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/sensors"
)

// Thresholds mirror the clients' alert rules (lib/farm.ts deriveAlerts) and
// add the two server-only ones. Tuned for the demo data; adjust per farm
// later via the rules table.
const (
	tankLowPct   = 30.0
	humidityHigh = 70.0
	batteryLowV  = 12.0
	offlineAfter = 30 * time.Minute
)

// Finding is one condition currently true, with the Bangla text the clients
// already use for it.
type Finding struct {
	Kind   string
	Title  string
	Detail string
	Tone   string
}

// Compute derives every condition that holds right now. Pure: the engine
// test suite can drive it without a database.
func Compute(farm *models.Farm, stock []models.StockItem, devices []models.Device, tasks []models.Task, faults []sensors.Fault, nowMs int64) []Finding {
	var out []Finding
	for i, m := range farm.Moist {
		if math.Round(m) < float64(farm.Threshold) {
			zone := models.ZoneLabel(i)
			out = append(out, Finding{
				Kind:   fmt.Sprintf("dry%d", i),
				Title:  zone + "-এ মাটি শুকনো",
				Detail: fmt.Sprintf("আর্দ্রতা %s%%, সীমা %s%%।", bangla.Num(int(math.Round(m))), bangla.Num(farm.Threshold)),
				Tone:   "bad",
			})
		}
	}
	if math.Round(farm.Tank) < tankLowPct {
		out = append(out, Finding{
			Kind:   "tank",
			Title:  "ট্যাংকে পানি কম",
			Detail: fmt.Sprintf("ট্যাংক %s%% আছে। সেচের আগে ভরে নিন।", bangla.Num(int(math.Round(farm.Tank)))),
			Tone:   "bad",
		})
	}
	if farm.Volt > 0 && farm.Volt < batteryLowV {
		out = append(out, Finding{
			Kind:   "battery",
			Title:  "ব্যাটারির চার্জ কম",
			Detail: fmt.Sprintf("ভোল্টেজ %sV। সোলার প্যানেল ও সংযোগ দেখুন।", bangla.Num(farm.Volt)), // bn keeps one decimal
			Tone:   "warn",
		})
	}
	if math.Round(farm.Humidity) >= humidityHigh {
		out = append(out, Finding{
			Kind:   "hum",
			Title:  "বাতাসে আর্দ্রতা বেশি",
			Detail: fmt.Sprintf("আর্দ্রতা %s%%। পাতায় রোগের লক্ষণ আছে কি না দেখুন।", bangla.Num(int(math.Round(farm.Humidity)))),
			Tone:   "warn",
		})
	}
	for _, s := range stock {
		if s.IsLow() {
			out = append(out, Finding{
				Kind:   "stock-" + s.ID,
				Title:  s.Name + " কম",
				Detail: fmt.Sprintf("আছে %s %s, সর্বনিম্ন %s।", bnQty(s.Qty), s.Unit, bnQty(s.Min)),
				Tone:   "warn",
			})
		}
	}
	for _, t := range tasks {
		if !t.Done && t.DueAt > 0 && t.DueAt < nowMs {
			out = append(out, Finding{
				Kind:   "task-" + t.ID,
				Title:  "কাজের সময় পার: " + t.Text,
				Detail: fmt.Sprintf("%s আগে করার কথা ছিল (দায়িত্বে: %s)।", agoLabel(nowMs-t.DueAt), t.Who),
				Tone:   "warn",
			})
		}
	}
	for _, f := range faults {
		zone := models.ZoneLabel(f.Zone)
		out = append(out, Finding{
			Kind:   fmt.Sprintf("sensor%d", f.Zone),
			Title:  zone + "-এর সেন্সরে সন্দেহ",
			Detail: f.Reason + "। এই জোনে অটো সেচ বন্ধ; সেন্সর ও তার দেখুন।",
			Tone:   "bad",
		})
	}
	cutoff := nowMs - offlineAfter.Milliseconds()
	for _, d := range devices {
		if d.LastSeenAt > 0 && d.LastSeenAt < cutoff {
			out = append(out, Finding{
				Kind:   "offline-" + d.ID,
				Title:  d.ID + " সাড়া দিচ্ছে না",
				Detail: fmt.Sprintf("শেষ সংযোগ %s আগে। বিদ্যুৎ বা নেটওয়ার্ক দেখুন।", agoLabel(nowMs-d.LastSeenAt)),
				Tone:   "warn",
			})
		}
	}
	return out
}

// EvalFarm upserts the farm's alerts to match Compute's findings: new
// conditions create rows (Ack reset) and notify, persisting ones bump
// LastAt, cleared ones flip Active off. Called by the engine every tick.
// changed reports whether the alert list a client shows is different now
// (an alert appeared, cleared or reworded) — the live stream's cue.
func EvalFarm(db *gorm.DB, farm *models.Farm, notify Notifier, now time.Time) (changed bool) {
	var stock []models.StockItem
	if err := db.Where("farm_id = ?", farm.ID).Find(&stock).Error; err != nil {
		log.Printf("alerts: loading stock for %s: %v", farm.ID, err)
		return false
	}
	var devices []models.Device
	if err := db.Where("farm_id = ?", farm.ID).Find(&devices).Error; err != nil {
		log.Printf("alerts: loading devices for %s: %v", farm.ID, err)
		return false
	}
	var tasks []models.Task
	if err := db.Where("farm_id = ? AND done = ? AND due_at > 0", farm.ID, false).Find(&tasks).Error; err != nil {
		log.Printf("alerts: loading tasks for %s: %v", farm.ID, err)
		return false
	}
	nowMs := now.UnixMilli()
	var faults []sensors.Fault
	if !farm.Simulate {
		faults = sensors.Faults(db, farm, now)
	}
	current := Compute(farm, stock, devices, tasks, faults, nowMs)

	var active []models.Alert
	if err := db.Where("farm_id = ? AND active = ?", farm.ID, true).Find(&active).Error; err != nil {
		log.Printf("alerts: loading active for %s: %v", farm.ID, err)
		return false
	}
	byKind := make(map[string]*models.Alert, len(active))
	for i := range active {
		byKind[active[i].Kind] = &active[i]
	}

	seen := map[string]bool{}
	for _, f := range current {
		seen[f.Kind] = true
		if row, ok := byKind[f.Kind]; ok {
			if row.Title != f.Title || row.Detail != f.Detail || row.Tone != f.Tone {
				changed = true
			}
			// column update, not Save: a whole-row write would undo an ack
			// (PATCH /alerts/:id) that landed since the rows were loaded
			if err := db.Model(row).Updates(map[string]any{
				"title": f.Title, "detail": f.Detail, "tone": f.Tone, "last_at": nowMs,
			}).Error; err != nil {
				log.Printf("alerts: updating %s for %s: %v", f.Kind, farm.ID, err)
			}
			continue
		}
		row := models.Alert{
			FarmID: farm.ID, Kind: f.Kind, Title: f.Title, Detail: f.Detail,
			Tone: f.Tone, Active: true, FirstAt: nowMs, LastAt: nowMs,
		}
		if err := db.Create(&row).Error; err != nil {
			log.Printf("alerts: creating %s for %s: %v", f.Kind, farm.ID, err)
			continue
		}
		changed = true
		if notify != nil {
			notify(farm, f.Title, f.Detail)
		}
	}
	for _, row := range active {
		if !seen[row.Kind] && row.Active {
			if err := db.Model(&row).Update("active", false).Error; err != nil {
				log.Printf("alerts: clearing %s for %s: %v", row.Kind, farm.ID, err)
				continue
			}
			changed = true
		}
	}
	return changed
}

// Notifier delivers one activation message (internal/notify's Router). It
// decides per farm — the demo farm with notifications off stays silent.
type Notifier func(farm *models.Farm, title, detail string)

// bnQty renders stock quantities without trailing zeros (18, 1.5 …).
func bnQty(v float64) string {
	if v == math.Trunc(v) {
		return bangla.Num(int(v))
	}
	return bangla.Num(v)
}

// agoLabel is a coarse "x দিন/ঘণ্টা/মিনিট" span for offline and overdue alerts.
func agoLabel(ms int64) string {
	mins := ms / 60_000
	switch {
	case mins < 60:
		return bangla.Num(mins) + " মিনিট"
	case mins < 24*60:
		return bangla.Num(mins/60) + " ঘণ্টা"
	}
	return bangla.Num(mins/(24*60)) + " দিন"
}
