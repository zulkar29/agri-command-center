package engine

import (
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

// A tick works on the farm row it loaded at its start; whatever an operator
// changed in the meantime must survive the tick's write.
func TestStepKeepsConcurrentChanges(t *testing.T) {
	db := testDB(t)
	farm := models.Farm{
		ID: "rf1", Slug: "race-farm", Name: "ফার্ম", Mode: "auto",
		Threshold: 35, Duration: 20, Tank: 60,
		Moist: []float64{20}, Valves: []bool{true},
	}
	if err := db.Create(&farm).Error; err != nil {
		t.Fatalf("seed farm: %v", err)
	}
	e := New(db, 30*time.Second)
	clock := time.Date(2026, 10, 7, 9, 0, 0, 0, models.FarmZone)
	e.Now = func() time.Time { return clock }

	// 1. a setting the engine does not own changes mid-tick: the engine still
	//    starts the pump, and the new threshold stays
	stale := farm
	if err := db.Model(&models.Farm{}).Where("id = ?", "rf1").Update("threshold", 50).Error; err != nil {
		t.Fatal(err)
	}
	e.stepFarm(&stale)
	var got models.Farm
	db.First(&got, "id = ?", "rf1")
	if !got.PumpOn || got.Threshold != 50 {
		t.Fatalf("pump on with threshold 50 expected, got pumpOn=%v threshold=%d", got.PumpOn, got.Threshold)
	}

	// 2. the operator stops the pump and goes manual mid-tick: the engine's
	//    stale "auto, pump on" decision must not be written back
	db.Model(&models.Farm{}).Where("id = ?", "rf1").Updates(map[string]any{"pump_on": false, "mode": "manual", "pump_since": nil})
	stale = got
	clock = clock.Add(30 * time.Second)
	e.stepFarm(&stale)
	db.First(&got, "id = ?", "rf1")
	if got.PumpOn || got.Mode != "manual" {
		t.Fatalf("operator's manual stop was overwritten: pumpOn=%v mode=%s", got.PumpOn, got.Mode)
	}
	if stale.PumpOn || stale.Mode != "manual" {
		t.Errorf("after a lost race the in-memory farm should be reloaded, got pumpOn=%v mode=%s", stale.PumpOn, stale.Mode)
	}
}
