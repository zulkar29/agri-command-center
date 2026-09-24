package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

func TestHarvestAndEfficiency(t *testing.T) {
	r, db := testDB(t)

	zone := 0
	field := models.Field{FarmID: "f1", Name: "টমেটো", Crop: "টমেটো", Area: 10, Plants: 100, HarvestAt: 70, Zone: &zone}
	if err := db.Create(&field).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&models.Farm{}).Where("id = ?", "f1").Update("pump_flow_lpm", 20).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	// one 30-minute run on zones 0 and 1 → 600 L, 300 L each
	if err := db.Create(&models.PumpRun{FarmID: "f1", Start: now - 3_600_000, End: now - 1_800_000,
		Zones: []int{0, 1}, Litres: 600, Source: "pump"}).Error; err != nil {
		t.Fatal(err)
	}

	code, body := request(t, r, http.MethodPost, "/api/v1/harvests", map[string]any{
		"fieldId": field.ID, "kg": 60, "pricePerKg": 40, "grade": "ক", "addIncome": true,
	})
	if code != http.StatusCreated {
		t.Fatalf("create harvest = %d: %v", code, body)
	}

	// the income landed in the ledger tagged to the field
	_, body = request(t, r, http.MethodGet, "/api/v1/ledger?field="+field.ID, nil)
	led := items(t, body)
	if len(led) != 1 || led[0].(map[string]any)["amount"] != float64(2400) {
		t.Fatalf("ledger = %v", led)
	}

	code, body = request(t, r, http.MethodGet, "/api/v1/reports/field-efficiency", nil)
	if code != http.StatusOK {
		t.Fatalf("efficiency = %d: %v", code, body)
	}
	row := items(t, body)[0].(map[string]any)
	if row["litres"] != float64(300) || row["kg"] != float64(60) || row["litresPerKg"] != float64(5) {
		t.Fatalf("efficiency row = %v", row)
	}

	code, body = request(t, r, http.MethodGet, "/api/v1/reports/water-use", nil)
	if code != http.StatusOK || body["litres"] != float64(600) {
		t.Fatalf("water summary = %d: %v", code, body)
	}

	// validation and unknown field
	if code, _ := request(t, r, http.MethodPost, "/api/v1/harvests", map[string]any{"fieldId": field.ID, "kg": 0}); code != http.StatusBadRequest {
		t.Errorf("kg=0 = %d, want 400", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/harvests", map[string]any{"fieldId": "nope", "kg": 5}); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown field = %d, want 400", code)
	}
}

func TestPumpRunTracksPumpToggle(t *testing.T) {
	r, db := testDB(t)
	if err := db.Model(&models.Farm{}).Where("id = ?", "f1").Update("pump_flow_lpm", 12).Error; err != nil {
		t.Fatal(err)
	}
	if code, body := request(t, r, http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "on"}); code != http.StatusOK {
		t.Fatalf("pump on = %d: %v", code, body)
	}
	var open int64
	db.Model(&models.PumpRun{}).Where("farm_id = ? AND \"end\" = 0", "f1").Count(&open)
	if open != 1 {
		t.Fatalf("open runs = %d, want 1", open)
	}
	// repeated "on" must not open a second run
	request(t, r, http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "on"})
	db.Model(&models.PumpRun{}).Where("farm_id = ? AND \"end\" = 0", "f1").Count(&open)
	if open != 1 {
		t.Fatalf("open runs after repeat = %d, want 1", open)
	}
	request(t, r, http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "off"})
	db.Model(&models.PumpRun{}).Where("farm_id = ? AND \"end\" = 0", "f1").Count(&open)
	if open != 0 {
		t.Fatalf("open runs after off = %d, want 0", open)
	}
}

func TestRotateDeviceKeyAndRequiredKey(t *testing.T) {
	r, db := testDB(t)
	if err := db.Create(&models.Device{ID: "node-1", FarmID: "f1", Kind: "sensor"}).Error; err != nil {
		t.Fatal(err)
	}
	code, body := request(t, r, http.MethodPost, "/api/v1/devices/node-1/key", nil)
	if code != http.StatusCreated || body["apiKey"] == "" || body["apiKey"] == nil {
		t.Fatalf("rotate = %d: %v", code, body)
	}
	key := body["apiKey"].(string)

	post := func(key string) int {
		raw := map[string]any{"node": "node-1", "soil_moisture": []float64{40}}
		return postTelemetry(t, r, key, raw)
	}
	if got := post("wrong"); got != http.StatusUnauthorized {
		t.Errorf("wrong key = %d, want 401", got)
	}
	if got := post(key); got != http.StatusCreated {
		t.Errorf("right key = %d, want 201", got)
	}
	if got := postTelemetry(t, r, key, map[string]any{"node": "node-1", "soil_moisture": []float64{40}, "air_humidity": 150}); got != http.StatusBadRequest {
		t.Errorf("humidity 150 = %d, want 400", got)
	}
}

func TestLedgerSummaryTotalsBeyondOnePage(t *testing.T) {
	r, db := testDB(t)
	rows := []models.LedgerEntry{}
	for i := 0; i < 250; i++ { // more than the 200-row page maximum
		rows = append(rows, models.LedgerEntry{FarmID: "f1", At: int64(i), Type: "expense", Cat: "সার", Amount: 10})
	}
	rows = append(rows, models.LedgerEntry{FarmID: "f1", At: 1, Type: "income", Cat: "বিক্রি", Amount: 4000})
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	code, body := request(t, r, http.MethodGet, "/api/v1/reports/ledger-summary", nil)
	if code != http.StatusOK || body["expense"] != float64(2500) || body["income"] != float64(4000) || body["profit"] != float64(1500) {
		t.Fatalf("summary = %d: %v", code, body)
	}
	if cats, _ := body["byCategory"].([]any); len(cats) != 2 {
		t.Errorf("byCategory = %v, want 2 rows", cats)
	}
}
