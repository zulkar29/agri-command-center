package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

// The clients map over list fields without null checks (p.items.map,
// Object.keys(d.metrics), r.byCategory …). A Go nil slice or map marshals to
// null, so on an empty farm every list the clients read must still be [] (and
// every object {}). client_contract_test.go checks the routes; this checks
// those payload shapes.

// arrayAt asserts that body[key] is a JSON array (not null, not missing).
func arrayAt(t *testing.T, what string, body map[string]any, key string) {
	t.Helper()
	if _, ok := body[key].([]any); !ok {
		t.Errorf("%s: %q = %#v, want a JSON array", what, key, body[key])
	}
}

func TestEmptyCollectionsAreArraysNotNull(t *testing.T) {
	r, db := testDB(t)

	paged := []string{
		"/fields", "/tasks", "/ledger", "/stock", "/schedules", "/observations",
		"/harvests", "/market-prices", "/devices", "/alerts", "/telemetry",
		"/pump-runs", "/users", "/audit",
	}
	for _, p := range paged {
		code, body := request(t, r, http.MethodGet, "/api/v1"+p, nil)
		if code != http.StatusOK {
			t.Errorf("GET %s = %d: %v", p, code, body)
			continue
		}
		arrayAt(t, "GET "+p, body, "items")
	}

	views := map[string][]string{
		"/farm":                     {"moist", "valves", "rules", "irrLog", "team"},
		"/reports/ledger-summary":   {"byCategory"},
		"/reports/field-profit":     {"items"},
		"/reports/water-use":        {"perZone", "perDay"},
		"/reports/field-efficiency": {"items"},
		"/reports/weekly-summary":   {"lowStock"},
		"/telemetry/buckets":        {"items"},
		"/crop-templates":           {"items"},
	}
	for p, keys := range views {
		code, body := request(t, r, http.MethodGet, "/api/v1"+p, nil)
		if code != http.StatusOK {
			t.Errorf("GET %s = %d: %v", p, code, body)
			continue
		}
		for _, k := range keys {
			arrayAt(t, "GET "+p, body, k)
		}
	}

	// unset coordinates are an explicit null: the clients merge the snapshot
	// over their store, so an omitted key would keep a stale location
	_, farm := request(t, r, http.MethodGet, "/api/v1/farm", nil)
	for _, k := range []string{"lat", "lng"} {
		if v, present := farm[k]; !present || v != nil {
			t.Errorf("GET /farm: %q = %#v (present %v), want null", k, v, present)
		}
	}

	// a device row stored without metrics still answers metrics: {}
	if err := db.Create(&models.Device{ID: "bare-node", FarmID: "f1", Kind: "sensor"}).Error; err != nil {
		t.Fatal(err)
	}
	_, body := request(t, r, http.MethodGet, "/api/v1/devices", nil)
	for _, d := range items(t, body) {
		if m, ok := d.(map[string]any)["metrics"].(map[string]any); !ok || m == nil {
			t.Errorf("device %v: metrics is not an object", d)
		}
	}

	// recommendations for a fresh field: items is a list
	code, field := request(t, r, http.MethodPost, "/api/v1/fields", map[string]any{"name": "মাঠ", "crop": "টমেটো", "harvestAt": 75})
	if code != http.StatusCreated {
		t.Fatalf("create field = %d: %v", code, field)
	}
	_, rec := request(t, r, http.MethodGet, "/api/v1/fields/"+field["id"].(string)+"/recommendations", nil)
	arrayAt(t, "GET /fields/:id/recommendations", rec, "items")
}

// Both clients treat any 401 on a logged-in request as "token expired":
// refresh, and log out when that fails. A wrong current password must
// therefore not be a 401, or changing a password with a typo would end the
// session.
func TestWrongCurrentPasswordIsNotUnauthorized(t *testing.T) {
	r, _ := testDB(t)
	code, body := request(t, r, http.MethodPost, "/api/v1/auth/password", map[string]any{
		"currentPassword": "not-the-password", "newPassword": "a-new-password",
	})
	if code != http.StatusUnprocessableEntity {
		t.Errorf("wrong current password = %d (%v), want 422", code, body)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/auth/me", nil); code != http.StatusOK {
		t.Errorf("session after a wrong current password = %d, want 200", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/auth/password", map[string]any{
		"currentPassword": "farm123", "newPassword": "a-new-password",
	}); code != http.StatusNoContent {
		t.Errorf("right current password = %d, want 204", code)
	}
}

// Every due label the clients offer is accepted — "এই সপ্তাহ" has a space,
// which gin's oneof cannot express — alone (dashboard without a date) and next
// to a dueAt (the mobile app always sends both).
func TestTaskAcceptsEveryDueLabel(t *testing.T) {
	r, _ := testDB(t)
	for _, due := range dueLabels {
		if code, body := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "কাজ", "who": "আমি", "due": due}); code != http.StatusCreated || body["due"] != due {
			t.Errorf("task due %q = %d: %v", due, code, body)
		}
		if code, body := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "কাজ", "who": "আমি", "due": due, "dueAt": time.Now().Add(time.Hour).UnixMilli()}); code != http.StatusCreated {
			t.Errorf("task due %q with dueAt = %d: %v", due, code, body)
		}
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "কাজ", "who": "আমি", "due": "এই"}); code != http.StatusBadRequest {
		t.Errorf("task due \"এই\" = %d, want 400", code)
	}
}
