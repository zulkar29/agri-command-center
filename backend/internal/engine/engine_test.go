package engine

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/testutil"
)

// Integration test against a real PostgreSQL — same deal as the API tests:
// it runs when TEST_DATABASE_URL is set (the docker compose stack exposes
// Postgres for exactly this) and skips otherwise.
func testDB(t *testing.T) *gorm.DB { return testutil.OpenDB(t, "engine_test") }

func TestEngineRunOnceAppliesDecisions(t *testing.T) {
	db := testDB(t)

	farm := models.Farm{
		ID: "ef1", Slug: "engine-farm", Name: "ইঞ্জিন ফার্ম", Mode: "auto", Simulate: true,
		Threshold: 35, Duration: 20, Tank: 68,
		Moist: []float64{44, 38, 31}, Valves: []bool{true, true, true},
	}
	if err := db.Create(&farm).Error; err != nil {
		t.Fatalf("seed farm: %v", err)
	}
	seed := []any{
		&models.Rule{ID: "r2", FarmID: "ef1", Text: "ট্যাংক ২০% এর নিচে নামলে পাম্প বন্ধ করো", On: true},
		&models.Schedule{ID: "es1", FarmID: "ef1", Time: "10:00", Dur: 20, Zone: "জোন খ", On: true},
		&models.Device{ID: "relay-1", FarmID: "ef1", Kind: "relay", Metrics: map[string]float64{"state": 0}},
	}
	for _, m := range seed {
		if err := db.Create(m).Error; err != nil {
			t.Fatalf("seed %T: %v", m, err)
		}
	}

	// 10:00 in Dhaka, handed to the engine as UTC (04:00Z): schedules are on
	// the farm's clock, whatever zone the host runs in
	clock := time.Date(2026, 10, 7, 10, 0, 0, 0, models.FarmZone).UTC()
	e := New(db, 30*time.Second)
	e.Now = func() time.Time { return clock }

	e.runOnce() // first sight: decisions + the 10:00 schedule, no physics yet

	var after models.Farm
	if err := db.First(&after, "id = ?", "ef1").Error; err != nil {
		t.Fatalf("reload farm: %v", err)
	}
	if !after.PumpOn {
		t.Fatal("auto mode with a dry zone should have started the pump")
	}
	if after.PumpSince == nil || !after.PumpSince.UTC().Equal(clock) {
		t.Fatalf("PumpSince should be the engine clock, got %v", after.PumpSince)
	}
	if after.Moist[1] != 48 { // 38 + the schedule's +10
		t.Fatalf("10:00 schedule should have watered জোন খ: %v", after.Moist[1])
	}
	var logs []models.LogEntry
	db.Where("farm_id = ?", "ef1").Order("created_at").Find(&logs)
	if len(logs) != 2 {
		t.Fatalf("expected start + schedule logs, got %d: %v", len(logs), logs)
	}
	var relay models.Device
	db.First(&relay, "id = ?", "relay-1")
	if relay.Metrics["state"] != 1 {
		t.Fatalf("relay should follow the pump: %v", relay.Metrics)
	}
	var sched models.Schedule
	db.First(&sched, "id = ?", "es1")
	if sched.LastRun == nil {
		t.Fatal("fired schedule should record LastRun")
	}

	clock = clock.Add(30 * time.Second)
	e.runOnce() // second tick: 30s of physics while the pump runs

	db.First(&after, "id = ?", "ef1")
	if after.Moist[2] <= 31 {
		t.Fatalf("watering should wet the dry zone: %v", after.Moist[2])
	}
	if after.Tank >= 68 {
		t.Fatalf("pump should drain the tank: %v", after.Tank)
	}
	db.Where("farm_id = ?", "ef1").Find(&logs)
	if len(logs) != 2 {
		t.Fatalf("steady state should add no logs, got %d", len(logs))
	}
}

// The daily cap counts today's pump minutes (including bursts) and keeps the
// auto mode from starting past it; with no cap the same farm starts normally.
func TestDailyPumpLimitBlocksAutoStart(t *testing.T) {
	db := testDB(t)
	clock := time.Date(2026, 10, 7, 10, 0, 0, 0, models.FarmZone).UTC()
	farm := models.Farm{
		ID: "ef2", Slug: "limit-farm", Name: "সীমা", Mode: "auto", Simulate: true,
		Threshold: 35, Duration: 20, Tank: 68, MaxDailyMinutes: 30,
		Moist: []float64{44, 38, 31}, Valves: []bool{true, true, true},
	}
	if err := db.Create(&farm).Error; err != nil {
		t.Fatal(err)
	}
	// 35 minutes already today (Dhaka), plus a run from yesterday that must not count
	nowMs := clock.UnixMilli()
	runs := []models.PumpRun{
		{FarmID: "ef2", Start: nowMs - 60*60_000, End: nowMs - 25*60_000, Source: "pump"},
		{FarmID: "ef2", Start: nowMs - 30*3_600_000, End: nowMs - 29*3_600_000, Source: "pump"},
	}
	if err := db.Create(&runs).Error; err != nil {
		t.Fatal(err)
	}

	e := New(db, 30*time.Second)
	e.Now = func() time.Time { return clock }
	e.runOnce()

	var after models.Farm
	db.First(&after, "id = ?", "ef2")
	if after.PumpOn {
		t.Fatal("35 min today ≥ 30 min cap — auto must not start the pump")
	}

	// lift the cap: the same dry zone now starts the pump
	db.Model(&models.Farm{}).Where("id = ?", "ef2").Update("max_daily_minutes", 0)
	e.runOnce()
	db.First(&after, "id = ?", "ef2")
	if !after.PumpOn {
		t.Fatal("without a cap the dry zone should start the pump")
	}
}
