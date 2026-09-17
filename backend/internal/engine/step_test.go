package engine

import (
	"math"
	"strings"
	"testing"
	"time"
)

// Pure-core tests for Step — no database, the clock is a fixed value, so
// every branch is deterministic. (Engine-shell integration lives in
// engine_test.go behind TEST_DATABASE_URL.)

var stepNow = time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)

// autoState mirrors the seed farm: auto mode, threshold 35, all valves open,
// zone গ already below the threshold, r2 tank guard on.
func autoState() State {
	return State{
		Mode: "auto", Threshold: 35, Duration: 20,
		Moist: []float64{44, 38, 31}, Valves: []bool{true, true, true},
		Tank: 68, TankRule: true,
	}
}

func TestAutoStartsBelowThreshold(t *testing.T) {
	res := Step(autoState(), nil, stepNow, 30*time.Second)

	if !res.State.PumpOn || !res.PumpChanged {
		t.Fatalf("pump should start: got on=%v changed=%v logs=%v", res.State.PumpOn, res.PumpChanged, res.Logs)
	}
	if !res.State.PumpSince.Equal(stepNow) {
		t.Fatalf("PumpSince should be now, got %v", res.State.PumpSince)
	}
	if got := res.Logs[0]; got != "অটো সেচ শুরু · মাটি সীমার নিচে" {
		t.Fatalf("start log = %q", got)
	}
	// 30s of watering: open zones rise toward 75, the tank drains
	if res.State.Moist[2] <= 31 {
		t.Fatalf("dry zone should wet: moist[2]=%v", res.State.Moist[2])
	}
	if res.State.Moist[1] <= 38 {
		t.Fatalf("every open zone wets: moist[1]=%v", res.State.Moist[1])
	}
	if res.State.Tank >= 68 {
		t.Fatalf("tank should drain: %v", res.State.Tank)
	}
}

func TestHysteresisStopWhenWetEnough(t *testing.T) {
	s := autoState()
	s.PumpOn = true
	s.PumpSince = stepNow.Add(-time.Minute)
	s.Moist = []float64{50, 48, 49} // all ≥ threshold+12 = 47

	res := Step(s, nil, stepNow, 30*time.Second)

	if res.State.PumpOn {
		t.Fatal("pump should stop once every open zone is ≥ threshold+12")
	}
	if got := res.Logs[0]; got != "অটো সেচ শেষ · আর্দ্রতা যথেষ্ট" {
		t.Fatalf("stop log = %q", got)
	}
	if !res.State.PumpSince.IsZero() {
		t.Fatal("stopping must clear PumpSince")
	}
}

func TestDurationStop(t *testing.T) {
	s := autoState()
	s.PumpOn = true
	s.PumpSince = stepNow.Add(-21 * time.Minute) // Duration is 20
	s.Moist = []float64{36, 37, 38}              // wet, but below the hysteresis bar

	res := Step(s, nil, stepNow, 30*time.Second)

	if res.State.PumpOn {
		t.Fatal("pump should stop after Duration minutes")
	}
	if !strings.Contains(res.Logs[0], "২০ মিনিট পার") {
		t.Fatalf("duration log = %q", res.Logs[0])
	}
}

func TestManualPumpRunHasNoDurationStop(t *testing.T) {
	s := autoState()
	s.PumpOn = true
	s.PumpSince = time.Time{} // a hand-driven run: the engine is not timing it
	s.Moist = []float64{36, 37, 38}
	s.Tank = 50

	res := Step(s, nil, stepNow.Add(2*time.Hour), 30*time.Second)

	if !res.State.PumpOn {
		t.Fatal("a manual run must not be auto-stopped by Duration")
	}
}

func TestTankRuleBlocksStartAndStopsRun(t *testing.T) {
	// blocked start: tank under the r2 floor
	s := autoState()
	s.Tank = 15
	if res := Step(s, nil, stepNow, 30*time.Second); res.State.PumpOn || len(res.Logs) > 0 {
		t.Fatalf("r2 should block the start: on=%v logs=%v", res.State.PumpOn, res.Logs)
	}

	// running pump: same low tank stops it
	s = autoState()
	s.PumpOn = true
	s.PumpSince = stepNow.Add(-time.Minute)
	s.Tank = 15
	s.Moist = []float64{36, 37, 38} // below hysteresis so r2 is the reason it stops

	res := Step(s, nil, stepNow, 30*time.Second)
	if res.State.PumpOn {
		t.Fatal("r2 should stop the pump at a low tank")
	}
	if got := res.Logs[0]; got != "ট্যাংক কম, পাম্প বন্ধ" {
		t.Fatalf("r2 log = %q", got)
	}
}

func TestDryTankStopsPump(t *testing.T) {
	s := autoState()
	s.PumpOn = true
	s.PumpSince = stepNow.Add(-time.Minute)
	s.TankRule = false // isolate the dry-tank stop from r2
	s.Tank = 1
	s.Moist = []float64{36, 37, 38}

	res := Step(s, nil, stepNow, 30*time.Second)

	if res.State.PumpOn || res.State.Tank != 0 {
		t.Fatalf("empty tank must stop the pump: on=%v tank=%v", res.State.PumpOn, res.State.Tank)
	}
	if got := res.Logs[0]; got != "ট্যাংক শূন্য, পাম্প বন্ধ" {
		t.Fatalf("dry-tank log = %q", got)
	}
}

func TestClosedValvesAreSkipped(t *testing.T) {
	s := autoState()
	s.Valves = []bool{true, false, true}

	res := Step(s, nil, stepNow, 30*time.Second)

	if res.State.Moist[1] != 38 {
		t.Fatalf("closed valve's zone must stay dry: moist[1]=%v", res.State.Moist[1])
	}
	if res.State.Moist[2] <= 31 {
		t.Fatalf("open valve's zone must wet: moist[2]=%v", res.State.Moist[2])
	}
}

func TestManualModeIdlesWithoutSimulate(t *testing.T) {
	s := autoState()
	s.Mode = "manual"
	s.PumpOn = false

	res := Step(s, nil, stepNow, time.Minute)

	if res.PumpChanged || len(res.Logs) > 0 {
		t.Fatalf("manual + idle should change nothing: %+v", res.Logs)
	}
	for i, m := range res.State.Moist {
		if m != s.Moist[i] {
			t.Fatalf("moist[%d] drifted without simulate: %v", i, m)
		}
	}
}

func TestSimulateDecayWhileIdle(t *testing.T) {
	s := autoState()
	s.Mode = "manual"
	s.Simulate = true

	res := Step(s, nil, stepNow, 30*time.Second)

	for i, m := range res.State.Moist {
		if !(m < s.Moist[i]) || m < 5 {
			t.Fatalf("moist[%d] should decay toward the floor: %v", i, m)
		}
	}
}

func TestScheduleFiresOncePerDay(t *testing.T) {
	s := autoState()
	s.Mode = "manual" // schedules run in any mode
	sched := Schedule{ID: "s1", Time: "10:00", Dur: 20, Zone: "জোন খ", On: true}

	res := Step(s, []Schedule{sched}, stepNow, 0)

	if len(res.SchedulesRun) != 1 || res.SchedulesRun[0] != "s1" {
		t.Fatalf("schedule should fire: %v", res.SchedulesRun)
	}
	if want := 38 + 10; res.State.Moist[1] != float64(want) {
		t.Fatalf("scheduled zone should wet by +10: %v", res.State.Moist[1])
	}
	if res.State.Tank != 66 {
		t.Fatalf("tank should drop 2 per zone: %v", res.State.Tank)
	}
	if got := res.Logs[0]; got != "সময়সূচি অনুযায়ী সেচ · জোন খ · ২০ মিনিট" {
		t.Fatalf("schedule log = %q", got)
	}

	// same minute, already run today → silent
	sched.LastRun = stepNow
	res = Step(res.State, []Schedule{sched}, stepNow.Add(30*time.Second), 30*time.Second)
	if len(res.SchedulesRun) != 0 || len(res.Logs) != 0 {
		t.Fatalf("schedule must not refire the same day: %v %v", res.SchedulesRun, res.Logs)
	}

	// tomorrow it fires again
	res = Step(res.State, []Schedule{sched}, stepNow.Add(24*time.Hour), 30*time.Second)
	if len(res.SchedulesRun) != 1 {
		t.Fatal("schedule should fire again the next day")
	}
}

func TestScheduleAllZonesAndClosedValve(t *testing.T) {
	s := autoState()
	s.Mode = "manual"
	s.Valves = []bool{true, false, true}

	all := Schedule{ID: "s-all", Time: "10:00", Zone: "সব জোন", On: true, Dur: 15}
	res := Step(s, []Schedule{all}, stepNow, 0)

	if res.State.Moist[1] != 38 {
		t.Fatalf("closed valve must be skipped by সব জোন: %v", res.State.Moist[1])
	}
	if res.State.Tank != 68-4 { // two open zones × 2
		t.Fatalf("tank should drop 2 per watered zone: %v", res.State.Tank)
	}

	// a schedule whose zone's valve is closed waters nothing, logs nothing
	closed := Schedule{ID: "s-c", Time: "10:00", Zone: "জোন খ", On: true, Dur: 10}
	res = Step(s, []Schedule{closed}, stepNow, 0)
	if len(res.SchedulesRun) != 0 || len(res.Logs) != 0 {
		t.Fatalf("closed-valve schedule should be a no-op: %v %v", res.SchedulesRun, res.Logs)
	}
}

func TestMoistureCapsAt75(t *testing.T) {
	s := autoState()
	s.Mode = "manual" // keep the pump running so physics is what wets the zones
	s.PumpOn = true
	s.Moist = []float64{74.9, 74.99, 74.5}

	res := Step(s, nil, stepNow, time.Hour)

	for i, m := range res.State.Moist {
		if m > 75 || math.IsNaN(m) {
			t.Fatalf("moist[%d] must cap at 75: %v", i, m)
		}
	}
}

func TestRainRuleSkipsAutoStartAndSchedules(t *testing.T) {
	// dry enough to start, but r1 + a wet forecast blocks it
	s := autoState()
	s.RainRule = true
	s.RainTomorrow = 80
	if res := Step(s, nil, stepNow, 30*time.Second); res.State.PumpOn {
		t.Fatal("r1 with rain ≥ 60% should block the auto start")
	}

	// same rule skips a due schedule (and marks it run)
	sched := Schedule{ID: "s1", Time: "10:00", Dur: 20, Zone: "জোন খ", On: true}
	res := Step(s, []Schedule{sched}, stepNow, 0)
	if len(res.SchedulesRun) != 1 || res.State.Moist[1] != 38 {
		t.Fatalf("r1 should skip (not water) the schedule: run=%v moist=%v", res.SchedulesRun, res.State.Moist[1])
	}
	if !strings.Contains(res.Logs[0], "সময়সূচির সেচ বাদ") {
		t.Fatalf("skip log = %q", res.Logs[0])
	}

	// unknown forecast (negative) never blocks
	s.RainTomorrow = -1
	if res := Step(s, nil, stepNow, 30*time.Second); !res.State.PumpOn {
		t.Fatal("unknown rain probability must not block the start")
	}
}

func TestAutoIgnoresFaultyZone(t *testing.T) {
	s := State{Mode: "auto", Threshold: 35, Duration: 10, Tank: 80,
		Moist: []float64{20, 60}, Valves: []bool{true, true}, Faulty: []bool{true, false}}
	res := Step(s, nil, time.Now(), 0)
	if res.State.PumpOn {
		t.Fatal("pump started from a faulty zone's reading")
	}
	s.Faulty = nil
	if res := Step(s, nil, time.Now(), 0); !res.State.PumpOn {
		t.Fatal("trusted dry zone should start the pump")
	}
}

func TestDailyLimitBlocksStartAndStopsEngineRun(t *testing.T) {
	s := autoState()
	s.DailyLimitHit = true
	if res := Step(s, nil, stepNow, 30*time.Second); res.State.PumpOn {
		t.Fatalf("auto must not start past the daily cap: %v", res.Logs)
	}

	// an engine-started run (PumpSince set) is cut when the cap is reached…
	s.PumpOn, s.PumpSince = true, stepNow.Add(-time.Minute)
	res := Step(s, nil, stepNow, 30*time.Second)
	if res.State.PumpOn || !res.PumpChanged {
		t.Fatalf("engine run should stop at the cap: %+v", res)
	}
	// …a manual run (no PumpSince) is the operator's call
	s.PumpOn, s.PumpSince, s.Mode = true, time.Time{}, "manual"
	if res := Step(s, nil, stepNow, 30*time.Second); !res.State.PumpOn {
		t.Fatal("manual runs are exempt from the cap")
	}
}
