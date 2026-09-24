package api

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

func TestAlertListFiltersAndAck(t *testing.T) {
	r, db := testDB(t)
	viewer := loginAs(t, r, db, "viewer@farm.com", models.RoleViewer)
	now := time.Now().UnixMilli()
	for _, al := range []models.Alert{
		{ID: "al-old", FarmID: "f1", Kind: "tank", Title: "ট্যাংক", Tone: "bad", Active: false, FirstAt: now - 3000, LastAt: now - 2000},
		{ID: "al-new", FarmID: "f1", Kind: "dry0", Title: "শুকনো", Tone: "bad", Active: true, FirstAt: now - 1000, LastAt: now},
		{ID: "al-x", FarmID: "other", Kind: "hum", Title: "অন্য ফার্ম", Tone: "warn", Active: true, LastAt: now},
	} {
		if err := db.Create(&al).Error; err != nil {
			t.Fatalf("seed alert: %v", err)
		}
	}

	_, body := requestWith(t, r, viewer, http.MethodGet, "/api/v1/alerts", nil)
	if list := items(t, body); len(list) != 2 || list[0].(map[string]any)["id"] != "al-new" {
		t.Fatalf("alerts (this farm, newest first) = %v", list)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/alerts?active=true", nil)
	if list := items(t, body); len(list) != 1 || list[0].(map[string]any)["id"] != "al-new" {
		t.Errorf("active=true = %v", list)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/alerts?active=false", nil)
	if list := items(t, body); len(list) != 1 || list[0].(map[string]any)["id"] != "al-old" {
		t.Errorf("active=false = %v, want only the cleared alert", list)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/alerts?active=yes", nil); code != http.StatusBadRequest {
		t.Errorf("active=yes = %d, want 400", code)
	}

	// ack: operator+ only, writes just the ack (the engine owns the rest)
	if code, _ := requestWith(t, r, viewer, http.MethodPatch, "/api/v1/alerts/al-new", map[string]any{"ack": true}); code != http.StatusForbidden {
		t.Errorf("viewer ack = %d, want 403", code)
	}
	code, body := request(t, r, http.MethodPatch, "/api/v1/alerts/al-new", map[string]any{"ack": true})
	if code != http.StatusOK || body["ack"] != true || body["active"] != true {
		t.Fatalf("ack = %d: %v", code, body)
	}
	var stored models.Alert
	db.First(&stored, "id = ?", "al-new")
	if !stored.Ack || stored.LastAt != now {
		t.Errorf("stored alert = %+v", stored)
	}
	if code, _ := request(t, r, http.MethodPatch, "/api/v1/alerts/al-x", map[string]any{"ack": true}); code != http.StatusNotFound {
		t.Errorf("ack another farm's alert = %d, want 404", code)
	}
	if code, _ := request(t, r, http.MethodPatch, "/api/v1/alerts/al-new", map[string]any{"ack": "yes"}); code != http.StatusBadRequest {
		t.Errorf("ack with a string = %d, want 400", code)
	}
}

func TestAuditListIncludesUserAdminAndFilters(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)

	request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "সার দিন", "who": "বাবা", "due": "আজ"})
	time.Sleep(5 * time.Millisecond) // distinct epoch-ms stamps keep the order stable
	request(t, r, http.MethodPost, "/api/v1/users", map[string]any{"name": "রহিম", "email": "rahim@farm.com", "password": "password1", "role": models.RoleViewer})
	db.Create(&models.AuditLog{FarmID: "other", UserName: "x", Action: "task.create", Detail: "অন্য ফার্ম", At: time.Now().UnixMilli()})

	if code, _ := requestWith(t, r, oper, http.MethodGet, "/api/v1/audit", nil); code != http.StatusForbidden {
		t.Errorf("operator audit = %d, want 403", code)
	}
	code, body := request(t, r, http.MethodGet, "/api/v1/audit", nil)
	if code != http.StatusOK {
		t.Fatalf("audit = %d: %v", code, body)
	}
	list := items(t, body)
	if len(list) != 2 || list[0].(map[string]any)["action"] != "user.create" || list[1].(map[string]any)["action"] != "task.create" {
		t.Fatalf("audit (newest first, user admin included, other farm out) = %v", list)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/audit?action=task.create&q=সার", nil)
	if list := items(t, body); len(list) != 1 || list[0].(map[string]any)["detail"] != "সার দিন" {
		t.Errorf("action+q filter = %v", list)
	}
	_, body = request(t, r, http.MethodGet, fmt.Sprintf("/api/v1/audit?from=%d", time.Now().Add(time.Hour).UnixMilli()), nil)
	if list := items(t, body); len(list) != 0 {
		t.Errorf("from=future = %v, want none", list)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/audit?from=yesterday", nil); code != http.StatusBadRequest {
		t.Errorf("from=yesterday = %d, want 400", code)
	}
}

func TestDeviceKeyAndCommands(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)
	for _, d := range []models.Device{
		{ID: "relay-1", FarmID: "f1", Kind: "relay", Metrics: map[string]float64{"state": 0}},
		{ID: "sensor-1", FarmID: "f1", Kind: "sensor", ApiKey: "k-sensor"},
	} {
		if err := db.Create(&d).Error; err != nil {
			t.Fatalf("seed device: %v", err)
		}
	}

	// key: owner only, 404 for unknown nodes, rotate replaces it
	if code, _ := requestWith(t, r, oper, http.MethodGet, "/api/v1/devices/sensor-1/key", nil); code != http.StatusForbidden {
		t.Errorf("operator key read = %d, want 403", code)
	}
	if code, body := request(t, r, http.MethodGet, "/api/v1/devices/sensor-1/key", nil); code != http.StatusOK || body["apiKey"] != "k-sensor" {
		t.Errorf("key read = %d: %v", code, body)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/devices/nope/key", nil); code != http.StatusNotFound {
		t.Errorf("unknown device key = %d, want 404", code)
	}
	_, body := request(t, r, http.MethodPost, "/api/v1/devices/sensor-1/key", nil)
	if fresh, _ := body["apiKey"].(string); len(fresh) != 64 || fresh == "k-sensor" {
		t.Fatalf("rotated key = %v", body)
	}
	if _, body2 := request(t, r, http.MethodGet, "/api/v1/devices/sensor-1/key", nil); body2["apiKey"] != body["apiKey"] {
		t.Errorf("key read after rotate = %v, want %v", body2["apiKey"], body["apiKey"])
	}
	if got := postTelemetry(t, r, "k-sensor", map[string]any{"node": "sensor-1", "soil_moisture": []float64{40}}); got != http.StatusUnauthorized {
		t.Errorf("telemetry with the old key = %d, want 401", got)
	}

	// commands: a new command is 201 with the relay row; only relays take them
	code, body := requestWith(t, r, oper, http.MethodPost, "/api/v1/devices/relay-1/commands", map[string]any{"command": "on"})
	if code != http.StatusCreated || body["id"] != "relay-1" || body["metrics"].(map[string]any)["state"] != float64(1) {
		t.Fatalf("relay on = %d: %v", code, body)
	}
	var farm models.Farm
	db.First(&farm, "id = ?", "f1")
	if !farm.PumpOn || farm.Mode != "manual" {
		t.Errorf("farm after relay on: pumpOn=%v mode=%s", farm.PumpOn, farm.Mode)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/devices/sensor-1/commands", map[string]any{"command": "on"}); code != http.StatusUnprocessableEntity {
		t.Errorf("command to a sensor = %d, want 422", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/devices/relay-1/commands", map[string]any{"command": "toggle"}); code != http.StatusBadRequest {
		t.Errorf("command toggle = %d, want 400", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/devices/nope/commands", map[string]any{"command": "off"}); code != http.StatusNotFound {
		t.Errorf("command to unknown device = %d, want 404", code)
	}
}

// Concurrent usages must not both pass the "enough stock" check on the same
// old quantity: 10 kg, five usages of 3 kg at once → exactly three succeed.
func TestConcurrentStockUsageNeverOverdraws(t *testing.T) {
	r, db := testDB(t)
	item := models.StockItem{ID: "st-1", FarmID: "f1", Name: "ইউরিয়া", Unit: "কেজি", Qty: 10}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 5)
	for range 5 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, _ := request(t, r, http.MethodPost, "/api/v1/stock/st-1/usages", map[string]any{"qty": 3})
			codes <- code
		}()
	}
	wg.Wait()
	close(codes)
	created, short := 0, 0
	for c := range codes {
		switch c {
		case http.StatusCreated:
			created++
		case http.StatusUnprocessableEntity:
			short++
		default:
			t.Errorf("usage = %d", c)
		}
	}
	db.First(&item, "id = ?", "st-1")
	if created != 3 || short != 2 || item.Qty != 1 {
		t.Errorf("created=%d short=%d qty=%v, want 3, 2 and 1", created, short, item.Qty)
	}

	// a delta adjusts in SQL and never goes below zero
	if code, body := request(t, r, http.MethodPatch, "/api/v1/stock/st-1", map[string]any{"delta": -5}); code != http.StatusOK || body["qty"] != float64(0) {
		t.Errorf("delta -5 = %d: %v, want qty 0", code, body)
	}
}

func TestUserRenameResetAndDeleteKeepTeamInStep(t *testing.T) {
	r, db := testDB(t)
	code, body := request(t, r, http.MethodPost, "/api/v1/users", map[string]any{"name": "করিম", "email": "Karim@Farm.com", "password": "password1", "role": models.RoleOperator})
	if code != http.StatusCreated {
		t.Fatalf("create user = %d: %v", code, body)
	}
	id := body["id"].(string)
	if code, _ := request(t, r, http.MethodPost, "/api/v1/users", map[string]any{"name": "আবার", "email": "karim@farm.com", "password": "password1", "role": models.RoleViewer}); code != http.StatusConflict {
		t.Errorf("same email again = %d, want 409", code)
	}

	// the account's own session, to check that a reset ends it
	_, login := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{"email": "karim@farm.com", "password": "password1"})
	refresh, _ := login["refreshToken"].(string)

	if code, _ := request(t, r, http.MethodPatch, "/api/v1/users/"+id, map[string]any{"name": "  "}); code != http.StatusBadRequest {
		t.Errorf("blank name = %d, want 400", code)
	}
	if code, body := request(t, r, http.MethodPatch, "/api/v1/users/"+id, map[string]any{"name": "করিম মিয়া", "role": models.RoleViewer, "password": "password2"}); code != http.StatusOK {
		t.Fatalf("patch user = %d: %v", code, body)
	}
	var team []models.TeamMember
	db.Where("farm_id = ?", "f1").Find(&team)
	if len(team) != 1 || team[0].Name != "করিম মিয়া" || team[0].Role != models.RoleViewer {
		t.Errorf("team after rename+role = %+v", team)
	}
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refreshToken": refresh}); code != http.StatusUnauthorized {
		t.Errorf("refresh after a password reset = %d, want 401", code)
	}

	if code, _ := request(t, r, http.MethodDelete, "/api/v1/users/"+id, nil); code != http.StatusNoContent {
		t.Fatalf("delete user = %d", code)
	}
	var left int64
	db.Model(&models.TeamMember{}).Where("farm_id = ?", "f1").Count(&left)
	if left != 0 {
		t.Errorf("team rows after delete = %d, want 0 (a renamed member must not be orphaned)", left)
	}
}

func TestInputValidationEdges(t *testing.T) {
	r, _ := testDB(t)
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPatch, "/api/v1/farm", map[string]any{"lat": 91}},
		{http.MethodPatch, "/api/v1/farm", map[string]any{"lng": -181}},
		{http.MethodPatch, "/api/v1/farm", map[string]any{"farmName": " "}},
		{http.MethodPost, "/api/v1/schedules", map[string]any{"time": "07:00", "dur": 10, "zone": "জোন ঘ"}},
		{http.MethodPost, "/api/v1/harvests", map[string]any{"fieldId": "x", "kg": 1, "at": time.Now().Add(time.Hour).UnixMilli()}},
	} {
		if code, body := request(t, r, tc.method, tc.path, tc.body); code != http.StatusBadRequest {
			t.Errorf("%s %s %v = %d: %v, want 400", tc.method, tc.path, tc.body, code, body)
		}
	}
	if code, body := request(t, r, http.MethodPost, "/api/v1/schedules", map[string]any{"time": "07:00", "dur": 10, "zone": "জোন খ"}); code != http.StatusCreated {
		t.Errorf("schedule for জোন খ = %d: %v", code, body)
	}

	// a device clock running ahead is refused; one a little behind is fine
	ahead := map[string]any{"node": "esp32-1", "ts": time.Now().Add(time.Hour).Unix(), "soil_moisture": []float64{40}}
	if got := postTelemetry(t, r, "", ahead); got != http.StatusBadRequest {
		t.Errorf("telemetry from the future = %d, want 400", got)
	}
	behind := map[string]any{"node": "esp32-1", "ts": time.Now().Add(-time.Minute).Unix(), "soil_moisture": []float64{40}}
	if got := postTelemetry(t, r, "", behind); got != http.StatusCreated {
		t.Errorf("telemetry a minute old = %d, want 201", got)
	}
}
