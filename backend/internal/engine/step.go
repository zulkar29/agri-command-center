package engine

import (
	"fmt"
	"math"
	"time"

	"github.com/farm-command/backend/internal/bangla"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/water"
)

// Physical rates, derived from the demo simulator the clients ran first
// (dashboard/src/atoms/farm.ts tick, every 3s): per second, per open zone.
const (
	moistUpPerSec    = 1.2 / 3  // soil moisture % gained while watering
	moistDecayPerSec = 0.06 / 3 // dry-out while the pump rests (simulate only)
	tankDrainPerSec  = 0.4 / 3  // tank % drained while the pump runs
	// auto-stop hysteresis: start below Threshold, stop at Threshold + 12
	stopHysteresis = 12
	// Rule r2 ("ট্যাংক ২০% এর নিচে নামলে পাম্প বন্ধ করো") guards at this level
	tankGuardFloor = 20.0
	// Rule r1 ("কাল বৃষ্টির সম্ভাবনা ৬০% এর বেশি হলে সেচ বাদ দাও") — tomorrow's
	// rain probability at or above this skips watering
	rainSkipPct = 60.0
)

// State is the farm control data one step needs — a projection of the farm
// row plus its rules, trimmed to plain values so the decision core below
// stays pure: Step has no clock, no database and no randomness (sensor drift
// lives in the Engine shell).
type State struct {
	Simulate bool
	Mode     string // 'auto' | 'manual'
	PumpOn   bool
	// PumpSince is when this pump-on stretch began (zero = unknown/manual);
	// the engine sets it on its own starts so Duration can stop the run.
	PumpSince time.Time
	Threshold int
	Duration  int // minutes
	Moist     []float64
	Valves    []bool
	Tank      float64
	// TankRule is rule r2 on: never start (and always stop) below 20% tank.
	TankRule bool
	// RainRule is rule r1 on: skip watering when tomorrow's rain probability
	// is at rainSkipPct. RainTomorrow is that probability; negative = unknown
	// (no farm coordinates or weather unreachable), which never blocks.
	RainRule     bool
	RainTomorrow float64
	// Faulty marks zones whose moisture sensor is distrusted (internal/
	// sensors: stuck, jumping, impossible). Auto mode ignores them when
	// deciding to start or stop, so a broken probe can neither flood a field
	// nor keep the pump running. Nil/short = all trusted.
	Faulty []bool
	// DailyLimitHit is set when today's pump minutes reached the farm's
	// MaxDailyMinutes: auto mode neither starts nor keeps running (manual
	// runs are the operator's call and stay untouched).
	DailyLimitHit bool
}

// Schedule mirrors the fields the engine acts on; Zone is a models.ZoneNames
// entry or "সব জোন".
type Schedule struct {
	ID   string
	Time string // "HH:MM"
	Dur  int    // minutes
	Zone string
	On   bool
	// LastRun is the day it last fired (zero = never); the caller persists
	// LastRun = today for every id in Result.SchedulesRun.
	LastRun time.Time
}

// Result is one step's outcome: the new state, log lines to record and which
// schedules fired.
type Result struct {
	State        State
	Logs         []string
	PumpChanged  bool
	SchedulesRun []string
	// Watered lists the schedules that actually watered (SchedulesRun also
	// holds rain-skipped ones) for the water account.
	Watered []Watering
}

// Watering is one schedule firing that watered zones.
type Watering struct {
	ID    string
	Zones []int
	Dur   int // minutes
}

func (r *Result) log(text string) { r.Logs = append(r.Logs, text) }

// Step advances one farm by elapsed seconds of physical time and returns what
// should change. It is the server-authoritative twin of the demo simulator's
// tick (the clients keep theirs for নমুনা মোড and stop it while live):
//
//   - auto mode: pump on when an open zone drops below Threshold; off when
//     every open zone reaches Threshold+12 (hysteresis), after Duration
//     minutes, or when rule r2 finds the tank low; a dry tank stops it too
//   - while the pump runs, open zones wet and the tank drains; closed valves
//     are skipped everywhere
//   - schedules water their zones at their minute, once per day, in any mode
func Step(s State, schedules []Schedule, now time.Time, elapsed time.Duration) Result {
	res := Result{State: s}
	st := &res.State
	// copy the slice so the caller's State stays untouched (pure function)
	st.Moist = append([]float64(nil), s.Moist...)
	dt := elapsed.Seconds()
	if dt < 0 {
		dt = 0
	}
	openIdx := water.OpenZones(st.Valves)
	trustedIdx := trusted(openIdx, st.Faulty)
	tankRuleLow := st.TankRule && st.Tank < tankGuardFloor
	rainSkip := st.RainRule && st.RainTomorrow >= rainSkipPct

	// (with every valve closed the stop branch matches vacuously — a pump
	// with nothing to water stops, same as the client simulator)
	if st.Mode == "auto" {
		switch {
		case !st.PumpOn && anyBelow(st.Moist, trustedIdx, st.Threshold) && st.Tank > 0 && !tankRuleLow && !rainSkip && !st.DailyLimitHit:
			st.PumpOn = true
			st.PumpSince = now
			res.PumpChanged = true
			res.log("অটো সেচ শুরু · মাটি সীমার নিচে")
		case st.PumpOn && !anyBelow(st.Moist, trustedIdx, st.Threshold+stopHysteresis):
			st.PumpOn = false
			res.PumpChanged = true
			res.log("অটো সেচ শেষ · আর্দ্রতা যথেষ্ট")
		}
		// the daily safety cap ends an engine-started run (manual runs exempt)
		if st.PumpOn && st.DailyLimitHit && !st.PumpSince.IsZero() {
			st.PumpOn = false
			res.PumpChanged = true
			res.log("অটো সেচ বন্ধ · আজকের পাম্প চালানোর সীমা শেষ")
		}
		// Duration passed on the engine's own run → stop. Manual runs have a
		// zero PumpSince and are exempt, matching the dashboard's semantics.
		if st.PumpOn && !st.PumpSince.IsZero() &&
			now.Sub(st.PumpSince) >= time.Duration(st.Duration)*time.Minute {
			st.PumpOn = false
			res.PumpChanged = true
			res.log(fmt.Sprintf("অটো সেচ শেষ · %s মিনিট পার", bangla.Num(st.Duration)))
		}
	}
	// rule r2 — a low tank always beats a running pump, auto or manual: in
	// manual the operator started it, but an emptying tank still stops the burn
	if st.PumpOn && tankRuleLow {
		st.PumpOn = false
		res.PumpChanged = true
		res.log("ট্যাংক কম, পাম্প বন্ধ")
	}

	if st.PumpOn {
		for _, i := range openIdx {
			st.Moist[i] = math.Min(75, st.Moist[i]+moistUpPerSec*dt)
		}
		st.Tank = math.Max(0, st.Tank-tankDrainPerSec*dt)
		if st.Tank <= 0 {
			st.PumpOn = false
			res.PumpChanged = true
			res.log("ট্যাংক শূন্য, পাম্প বন্ধ")
		}
	} else {
		st.PumpSince = time.Time{}
		if st.Simulate {
			for i := range st.Moist {
				st.Moist[i] = math.Max(5, st.Moist[i]-moistDecayPerSec*dt)
			}
		}
	}

	res.fireSchedules(schedules, openIdx, now)
	return res
}

// fireSchedules waters the zones of every due schedule (its HH:MM equals
// now's, not already run today) with the same effect the manual water button
// applies: +10% moisture and −2% tank per zone, capped.
func (r *Result) fireSchedules(schedules []Schedule, openIdx []int, now time.Time) {
	st := &r.State
	for _, sc := range schedules {
		if !sc.On || sc.Time != now.Format("15:04") || sameDay(sc.LastRun, now) {
			continue
		}
		// r1 blocks scheduled watering too — but the slot still counts as run
		// (LastRun is marked) so it is not retried on every tick of the minute
		if st.RainRule && st.RainTomorrow >= rainSkipPct {
			r.log(fmt.Sprintf("বৃষ্টির সম্ভাবনা %s%% — সময়সূচির সেচ বাদ", bangla.Num(int(st.RainTomorrow))))
			r.SchedulesRun = append(r.SchedulesRun, sc.ID)
			continue
		}
		zones := scheduleZones(sc.Zone, openIdx)
		if len(zones) == 0 {
			continue
		}
		for _, i := range zones {
			st.Moist[i] = math.Min(75, st.Moist[i]+10)
		}
		st.Tank = math.Max(0, st.Tank-2*float64(len(zones)))
		r.log(fmt.Sprintf("সময়সূচি অনুযায়ী সেচ · %s · %s মিনিট", joinZones(zones), bangla.Num(sc.Dur)))
		r.SchedulesRun = append(r.SchedulesRun, sc.ID)
		r.Watered = append(r.Watered, Watering{ID: sc.ID, Zones: zones, Dur: sc.Dur})
	}
}

// scheduleZones maps a schedule's zone label to open-zone indexes; "সব জোন"
// means every open zone, unknown labels water nothing.
func scheduleZones(zone string, openIdx []int) []int {
	if zone == "সব জোন" {
		return openIdx
	}
	for i, name := range models.ZoneNames {
		if zone == name {
			for _, open := range openIdx {
				if open == i {
					return []int{i}
				}
			}
		}
	}
	return nil
}

func joinZones(idxs []int) string {
	out := ""
	for n, i := range idxs {
		if n > 0 {
			out += ", "
		}
		out += models.ZoneLabel(i)
	}
	return out
}

// trusted drops the zones flagged faulty.
func trusted(idxs []int, faulty []bool) []int {
	var out []int
	for _, i := range idxs {
		if i < len(faulty) && faulty[i] {
			continue
		}
		out = append(out, i)
	}
	return out
}

func anyBelow(moist []float64, idxs []int, limit int) bool {
	for _, i := range idxs {
		if i < len(moist) && moist[i] < float64(limit) {
			return true
		}
	}
	return false
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}
