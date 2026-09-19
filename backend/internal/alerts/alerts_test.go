package alerts

import (
	"strings"
	"testing"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/sensors"
)

// Compute is pure — these tests need no database.
func TestComputeFindsEachCondition(t *testing.T) {
	nowMs := int64(1_700_000_000_000)
	farm := &models.Farm{
		Threshold: 35, Moist: []float64{44, 30, 50}, Valves: []bool{true, true, true},
		Tank: 22, Humidity: 74, Volt: 11.8,
	}
	stock := []models.StockItem{{ID: "s1", Name: "পটাশ সার", Unit: "কেজি", Qty: 6, Min: 10}}
	devices := []models.Device{
		{ID: "esp32-field-1", LastSeenAt: nowMs - 45*60_000}, // 45 min stale → offline
		{ID: "pump-relay-1", LastSeenAt: nowMs - 60_000},     // fresh → fine
	}

	got := Compute(farm, stock, devices, nil, nil, nowMs)
	kinds := map[string]Finding{}
	for _, f := range got {
		kinds[f.Kind] = f
	}

	for _, want := range []string{"dry1", "tank", "battery", "hum", "stock-s1", "offline-esp32-field-1"} {
		if _, ok := kinds[want]; !ok {
			t.Fatalf("missing finding %q in %v", want, got)
		}
	}
	if _, ok := kinds["dry0"]; ok {
		t.Fatal("zone ক (44) is above the threshold — no dry0 expected")
	}
	if !strings.Contains(kinds["dry1"].Title, "জোন খ") {
		t.Fatalf("dry zone should be labeled with its zone name: %q", kinds["dry1"].Title)
	}
	if !strings.Contains(kinds["stock-s1"].Detail, "কেজি") {
		t.Fatalf("stock detail should carry the unit: %q", kinds["stock-s1"].Detail)
	}
}

func TestComputeQuietFarm(t *testing.T) {
	nowMs := int64(1_700_000_000_000)
	farm := &models.Farm{
		Threshold: 35, Moist: []float64{44, 40, 50}, Valves: []bool{true, true, true},
		Tank: 68, Humidity: 60, Volt: 12.6,
	}
	if got := Compute(farm, nil, nil, nil, nil, nowMs); len(got) != 0 {
		t.Fatalf("healthy farm should have no findings: %v", got)
	}
}

func TestComputeIgnoresMissingSensors(t *testing.T) {
	// volt 0 = no battery sensor attached — must not alert
	farm := &models.Farm{Threshold: 35, Moist: []float64{50, 50, 50}, Tank: 80, Humidity: 50, Volt: 0}
	if got := Compute(farm, nil, nil, nil, nil, 0); len(got) != 0 {
		t.Fatalf("volt 0 means no sensor, not a dead battery: %v", got)
	}
}

func TestSensorFaultAlert(t *testing.T) {
	farm := &models.Farm{Threshold: 30, Tank: 80, Moist: []float64{50, 50}}
	got := Compute(farm, nil, nil, nil, []sensors.Fault{{Zone: 1, Reason: "একই মান"}}, 0)
	if len(got) != 1 || got[0].Kind != "sensor1" {
		t.Fatalf("findings = %+v", got)
	}
}

func TestComputeOverdueTasksAndLowStockBoundary(t *testing.T) {
	nowMs := int64(1_700_000_000_000)
	farm := &models.Farm{Threshold: 35, Moist: []float64{50}, Tank: 80, Humidity: 50}
	tasks := []models.Task{
		{ID: "t1", Text: "স্প্রে", Who: "বাবা", DueAt: nowMs - 26*3_600_000},       // overdue
		{ID: "t2", Text: "সার", Who: "আমি", DueAt: nowMs + 3_600_000},              // not yet
		{ID: "t3", Text: "পানি", Who: "আমি", DueAt: nowMs - 3_600_000, Done: true}, // done
		{ID: "t4", Text: "পুরোনো লেবেল", Who: "আমি"},                               // no deadline
	}
	stock := []models.StockItem{
		{ID: "a", Name: "ঠিক মিনিমামে", Unit: "কেজি", Qty: 10, Min: 10}, // at the minimum → low
		{ID: "b", Name: "মিনিমাম নেই", Unit: "কেজি", Qty: 0, Min: 0},    // no minimum → never low
	}
	kinds := map[string]Finding{}
	for _, f := range Compute(farm, stock, nil, tasks, nil, nowMs) {
		kinds[f.Kind] = f
	}
	if _, ok := kinds["task-t1"]; !ok || !strings.Contains(kinds["task-t1"].Detail, "১ দিন") {
		t.Fatalf("overdue task should alert with its age: %+v", kinds)
	}
	for _, k := range []string{"task-t2", "task-t3", "task-t4", "stock-b"} {
		if _, ok := kinds[k]; ok {
			t.Fatalf("%s must not alert: %+v", k, kinds)
		}
	}
	if _, ok := kinds["stock-a"]; !ok {
		t.Fatal("stock at its minimum is low (same test as GET /stock?low=true)")
	}
}
