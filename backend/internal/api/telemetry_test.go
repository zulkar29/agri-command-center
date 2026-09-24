package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

func TestTelemetryBuckets(t *testing.T) {
	r, db := testDB(t)

	// two nodes inside one Dhaka-local hour (well inside the 24h window), one
	// reading in the hour before; esp32-2 reports no tank and only 1 zone
	hour := time.Now().Add(-3 * time.Hour).In(bucketOrigin.Location()).Truncate(time.Hour)
	rows := []models.Telemetry{
		{FarmSlug: "test-farm", Node: "esp32-1", Ts: hour.Add(-30 * time.Minute),
			SoilMoisture: []float64{10, 20, 30}, AirTemp: 20, TankLevel: 50, BatteryV: 12},
		{FarmSlug: "test-farm", Node: "esp32-1", Ts: hour.Add(10 * time.Minute),
			SoilMoisture: []float64{40, 50, 60}, AirTemp: 30, TankLevel: 70, BatteryV: 12},
		{FarmSlug: "test-farm", Node: "esp32-2", Ts: hour.Add(20 * time.Minute),
			SoilMoisture: []float64{20}, AirTemp: 26, BatteryV: 11},
		{FarmSlug: "other-farm", Node: "esp32-9", Ts: hour.Add(5 * time.Minute),
			SoilMoisture: []float64{99}, AirTemp: 99},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatalf("seed telemetry: %v", err)
	}

	code, body := request(t, r, http.MethodGet, "/api/v1/telemetry/buckets?bucket=1h", nil)
	if code != http.StatusOK {
		t.Fatalf("buckets = %d: %v", code, body)
	}
	got := items(t, body)
	if len(got) != 2 {
		t.Fatalf("got %d buckets, want 2 (other farm excluded): %v", len(got), got)
	}
	b := got[1].(map[string]any)
	if ts, _ := time.Parse(time.RFC3339, b["ts"].(string)); !ts.Equal(hour) {
		t.Errorf("bucket ts = %v, want %v", b["ts"], hour)
	}
	if b["count"] != float64(2) || b["air_temp"] != float64(28) || b["battery_v"] != 11.5 {
		t.Errorf("bucket averages = %v", b)
	}
	// tank 0 = not reported, so only esp32-1's 70 counts
	if b["tank_level"] != float64(70) {
		t.Errorf("tank_level = %v, want 70", b["tank_level"])
	}
	// zone 0 averages both nodes, zones 1-2 only esp32-1
	moist, _ := b["soil_moisture"].([]any)
	if len(moist) != 3 || moist[0] != float64(30) || moist[1] != float64(50) || moist[2] != float64(60) {
		t.Errorf("soil_moisture = %v, want [30 50 60]", moist)
	}

	_, body = request(t, r, http.MethodGet, "/api/v1/telemetry/buckets?bucket=1d&node=esp32-2", nil)
	if got := items(t, body); len(got) != 1 || got[0].(map[string]any)["tank_level"] != nil {
		t.Errorf("node=esp32-2 daily = %v, want one bucket with null tank", got)
	}

	if code, _ := request(t, r, http.MethodGet, "/api/v1/telemetry/buckets?bucket=2h", nil); code != http.StatusBadRequest {
		t.Errorf("bucket=2h = %d, want 400", code)
	}
}

func TestDeviceAuthorized(t *testing.T) {
	cases := []struct {
		name          string
		found         bool
		key, given    string
		require, want bool
	}{
		{"open when not required, no key", true, "", "", false, true},
		{"unknown node open when not required", false, "", "", false, true},
		{"unknown node refused when required", false, "", "x", true, false},
		{"keyless device refused when required", true, "", "", true, false},
		{"right key", true, "k1", "k1", true, true},
		{"wrong key", true, "k1", "k2", false, false},
		{"missing key header", true, "k1", "", false, false},
	}
	for _, c := range cases {
		if got := deviceAuthorized(c.found, c.key, c.given, c.require); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}
