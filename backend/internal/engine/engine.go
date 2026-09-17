// Package engine runs the farm automation server-side: every Interval it
// steps each farm through the irrigation rules (auto mode thresholds,
// Duration stop, the r2 tank guard, schedules) and writes what changed back
// to the database, so the decisions hold while no client is connected.
//
// The decision core (Step, step.go) is pure and clock-injected; this file is
// the thin shell around it — loading farms, applying results, drifting the
// simulated sensors and keeping the pump relay row in sync. It is the
// server-side twin of the demo simulator the clients ran first; while a
// server is connected the clients stop their own tick (see atoms/farm.ts /
// state/engine.ts) and this engine is the only writer.
//
// When MQTT arrives (docs/05), the engine's pump starts/stops become commands
// the bridge publishes; until then they only flip farm.pump_on and the relay
// device row, exactly like PUT /api/v1/farm/pump does.
package engine

import (
	"context"
	"log"
	"math"
	"math/rand"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/pump"
	"github.com/farm-command/backend/internal/sensors"
	"github.com/farm-command/backend/internal/water"
)

// DefaultInterval is the tick cadence main.go uses unless ENGINE_INTERVAL
// overrides it. 30s keeps auto decisions snappy while staying gentle on the
// database; every scheduled minute still fires because schedules match on
// HH:MM and remember their last run day.
const DefaultInterval = 30 * time.Second

// maxElapsed caps how much physical time one tick may advance after a gap
// (server asleep, laptop lid closed) so moisture cannot jump absurdly.
const maxElapsed = 10 * time.Minute

type Engine struct {
	DB       *gorm.DB
	Interval time.Duration
	// Now is the clock; overridable so tests can move time. Nil → time.Now.
	Now func() time.Time
	// Weather feeds rule r1's rain-skip (internal/weather). Nil → r1 never
	// blocks (no forecast known).
	Weather WeatherSource
	// EvalAlerts runs the server-side alert evaluation after each farm's
	// step (internal/alerts). Nil → alerts stay client-derived.
	EvalAlerts func(farm *models.Farm, now time.Time)

	// lastSeen remembers each farm's previous tick to derive elapsed
	// physical time (the rates in step.go are per second).
	lastSeen map[string]time.Time
}

// WeatherSource is the rain forecast the r1 rule reads (internal/weather
// implements it; tests can stub it).
type WeatherSource interface {
	RainTomorrow(ctx context.Context, lat, lng float64) (float64, bool)
}

// New builds an engine; call Start to run it.
func New(db *gorm.DB, interval time.Duration) *Engine {
	if interval <= 0 {
		interval = DefaultInterval
	}
	return &Engine{DB: db, Interval: interval, lastSeen: map[string]time.Time{}}
}

// Start blocks, stepping every farm once per Interval until ctx is done.
// Run it on a goroutine (cmd/server/main.go does).
func (e *Engine) Start(ctx context.Context) {
	if e.Now == nil {
		e.Now = time.Now
	}
	log.Printf("irrigation engine started (every %s)", e.Interval)
	ticker := time.NewTicker(e.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.runOnce()
		}
	}
}

func (e *Engine) runOnce() {
	if e.Now == nil {
		e.Now = time.Now
	}
	if e.lastSeen == nil {
		e.lastSeen = map[string]time.Time{}
	}
	var farms []models.Farm
	if err := e.DB.Find(&farms).Error; err != nil {
		log.Printf("engine: loading farms: %v", err)
		return
	}
	for i := range farms {
		e.stepFarm(&farms[i])
		water.Sync(e.DB, &farms[i], e.Now())
		if e.EvalAlerts != nil {
			e.EvalAlerts(&farms[i], e.Now())
		}
	}
}

func (e *Engine) stepFarm(farm *models.Farm) {
	// schedules are HH:MM on the farm's clock, whatever zone the host runs in
	now := e.Now().In(models.FarmZone)
	prev, seen := e.lastSeen[farm.ID]
	e.lastSeen[farm.ID] = now

	// first sight decides but applies no physics; a long gap is clamped
	elapsed := time.Duration(0)
	if seen {
		elapsed = now.Sub(prev)
		if elapsed > maxElapsed {
			elapsed = maxElapsed
		}
		if elapsed < 0 {
			elapsed = 0
		}
	}

	var rules []models.Rule
	if err := e.DB.Where("farm_id = ?", farm.ID).Find(&rules).Error; err != nil {
		log.Printf("engine: loading rules for %s: %v", farm.ID, err)
		return
	}
	tankRule, rainRule := false, false
	for _, r := range rules {
		if !r.On {
			continue
		}
		switch ruleKind(r) {
		case models.RuleTankGuard:
			tankRule = true
		case models.RuleRainSkip:
			rainRule = true
		}
	}
	// r1 needs tomorrow's rain probability — read the weather cache when the
	// farm has coordinates; anything unknown stays negative (never blocks)
	rainTomorrow := -1.0
	if rainRule && e.Weather != nil && farm.Lat != nil && farm.Lng != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if rain, ok := e.Weather.RainTomorrow(ctx, *farm.Lat, *farm.Lng); ok {
			rainTomorrow = rain
		}
		cancel()
	}

	var rows []models.Schedule
	if err := e.DB.Where("farm_id = ?", farm.ID).Order("created_at").Find(&rows).Error; err != nil {
		log.Printf("engine: loading schedules for %s: %v", farm.ID, err)
		return
	}
	schedules := make([]Schedule, len(rows))
	for i, sc := range rows {
		schedules[i] = Schedule{ID: sc.ID, Time: sc.Time, Dur: sc.Dur, Zone: sc.Zone, On: sc.On}
		if sc.LastRun != nil {
			schedules[i].LastRun = *sc.LastRun
		}
	}

	state := State{
		Simulate: farm.Simulate, Mode: farm.Mode, PumpOn: farm.PumpOn,
		Threshold: farm.Threshold, Duration: farm.Duration,
		Moist: farm.Moist, Valves: farm.Valves, Tank: farm.Tank,
		TankRule: tankRule, RainRule: rainRule, RainTomorrow: rainTomorrow,
	}
	if !farm.Simulate {
		faults := sensors.Faults(e.DB, farm, now)
		state.Faulty = sensors.FaultyMask(faults, len(farm.Moist))
	}
	if farm.MaxDailyMinutes > 0 {
		state.DailyLimitHit = water.MinutesToday(e.DB, farm.ID, now) >= float64(farm.MaxDailyMinutes)
	}
	if farm.PumpSince != nil {
		state.PumpSince = *farm.PumpSince
	}
	res := Step(state, schedules, now, elapsed)

	// Simulated sensor drift is shell-side randomness (Step stays pure) —
	// the same walk the client simulator applies, scaled by elapsed time.
	if farm.Simulate {
		k := elapsed.Seconds() / 3 // rates were tuned per 3s client tick
		farm.Humidity = walk(farm.Humidity, 0.6*k, 55, 95)
		farm.Temp = walk(farm.Temp, 0.2*k, 18, 38)
		farm.Volt = walk(farm.Volt, 0.04*k, 11.8, 13.6)
	}

	// Only write when something moved: an event, a running pump (physics
	// shifted moist/tank) or the simulator's endless drift.
	dirty := res.PumpChanged || len(res.Logs) > 0 || state.PumpOn || farm.Simulate
	if !dirty {
		return
	}

	farm.Moist = res.State.Moist
	farm.Tank = res.State.Tank
	farm.PumpOn = res.State.PumpOn
	if res.State.PumpSince.IsZero() {
		farm.PumpSince = nil
	} else {
		since := res.State.PumpSince
		farm.PumpSince = &since
	}
	// Write only the columns the engine owns, and only if nobody switched the
	// mode or the pump since this tick loaded the row (PUT /farm/pump, PATCH
	// /farm, a device command): a whole-row Save would put the old settings
	// back and could restart a pump the operator just stopped. A lost race
	// skips this tick; the next one decides again on fresh state.
	upd := e.DB.Model(farm).Where("mode = ? AND pump_on = ?", state.Mode, state.PumpOn).
		Select("moist", "tank", "pump_on", "pump_since", "humidity", "temp", "volt").Updates(farm)
	if upd.Error != nil {
		log.Printf("engine: saving farm %s: %v", farm.ID, upd.Error)
		return
	}
	if upd.RowsAffected == 0 {
		// reload so the water account and alerts after this step see the
		// state that won, not the one this tick computed
		var fresh models.Farm
		if err := e.DB.First(&fresh, "id = ?", farm.ID).Error; err == nil {
			*farm = fresh
		}
		return
	}
	for _, text := range res.Logs {
		if err := e.DB.Create(&models.LogEntry{FarmID: farm.ID, At: now.UnixMilli(), Text: text}).Error; err != nil {
			log.Printf("engine: writing log for %s: %v", farm.ID, err)
		}
	}
	for _, id := range res.SchedulesRun {
		if err := e.DB.Model(&models.Schedule{}).Where("id = ?", id).Update("last_run", now).Error; err != nil {
			log.Printf("engine: marking schedule %s: %v", id, err)
		}
	}
	for _, w := range res.Watered {
		water.Burst(e.DB, farm, w.Zones, w.Dur, "schedule", now)
	}
	if res.PumpChanged {
		pump.SyncRelay(e.DB, farm.ID, res.State.PumpOn, now)
	}
}

// ruleKind is the behaviour a rule switches. Rows written before Rule.Kind
// existed are recognised by their seed ids so an upgrade needs no reset.
func ruleKind(r models.Rule) string {
	if r.Kind != "" {
		return r.Kind
	}
	switch r.ID {
	case "r1":
		return models.RuleRainSkip
	case "r2":
		return models.RuleTankGuard
	}
	return ""
}

// walk nudges x by ±range/2, clamped — the client simulator's drift helper.
func walk(x, rng, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, x+(rand.Float64()-0.5)*rng))
}
