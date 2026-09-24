package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

// --- tasks: exact deadlines, repeating, overdue -------------------------------

func TestTaskDeadlinesRepeatAndOverdue(t *testing.T) {
	r, _ := testDB(t)
	now := time.Now()

	// a deadline derives the coarse label; label alone is still accepted
	code, body := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{
		"text": "স্প্রে", "who": "বাবা", "dueAt": now.Add(-26 * time.Hour).UnixMilli(), "repeatDays": 10,
	})
	if code != http.StatusCreated || body["due"] != "আজ" {
		t.Fatalf("create with dueAt = %d: %v", code, body)
	}
	repeating := body["id"].(string)
	if code, _ := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "পরে", "who": "আমি", "due": "কাল"}); code != http.StatusCreated {
		t.Fatalf("label-only task = %d", code)
	}
	// neither label nor deadline, and bad numbers → 400
	for _, bad := range []map[string]any{
		{"text": "x", "who": "y"},
		{"text": "x", "who": "y", "due": "আজ", "repeatDays": 400},
		{"text": "x", "who": "y", "due": "আজ", "dueAt": -5},
		{"text": "x", "who": "y", "due": "কখনো"},
	} {
		if code, _ := request(t, r, http.MethodPost, "/api/v1/tasks", bad); code != http.StatusBadRequest {
			t.Errorf("task %v = %d, want 400", bad, code)
		}
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "x", "who": "y", "due": "আজ", "fieldId": "nope"}); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown field = %d, want 422", code)
	}

	// overdue filter lists only the open task whose deadline passed
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?overdue=true", nil)
	if list := items(t, body); len(list) != 1 || list[0].(map[string]any)["id"] != repeating {
		t.Fatalf("overdue = %v", list)
	}
	// ordering: deadline tasks before label-only ones
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks", nil)
	if list := items(t, body); list[0].(map[string]any)["id"] != repeating {
		t.Fatalf("task with a deadline should come first: %v", list)
	}

	// completing a repeating task makes the next one, in the future
	code, body = request(t, r, http.MethodPatch, "/api/v1/tasks/"+repeating, map[string]any{"done": true})
	if code != http.StatusOK || body["done"] != true {
		t.Fatalf("complete = %d: %v", code, body)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?done=false&q=স্প্রে", nil)
	next := items(t, body)
	if len(next) != 1 {
		t.Fatalf("expected the follow-up task: %v", next)
	}
	nt := next[0].(map[string]any)
	if nt["id"] == repeating || nt["repeatDays"] != float64(10) || int64(nt["dueAt"].(float64)) <= now.UnixMilli() {
		t.Fatalf("follow-up should be a new, future, still-repeating task: %v", nt)
	}
	// re-sending done on an already-done task must not spawn another (idempotent PATCH)
	request(t, r, http.MethodPatch, "/api/v1/tasks/"+repeating, map[string]any{"done": true})
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?q=স্প্রে", nil)
	if n := len(items(t, body)); n != 2 {
		t.Fatalf("PATCH done twice created extra tasks: %d rows", n)
	}
}

func TestDueLabel(t *testing.T) {
	now := time.Date(2026, 10, 7, 23, 30, 0, 0, models.FarmZone) // late evening in Dhaka
	at := func(days int, hour int) int64 {
		return time.Date(2026, 10, 7+days, hour, 0, 0, 0, models.FarmZone).UnixMilli()
	}
	for _, c := range []struct {
		dueAt int64
		want  string
	}{
		{at(0, 6), "আজ"}, {at(-3, 6), "আজ"}, {at(1, 0), "কাল"}, {at(1, 23), "কাল"},
		{at(2, 6), "এই সপ্তাহ"}, {at(7, 6), "এই সপ্তাহ"}, {at(8, 6), "পরে"},
	} {
		if got := dueLabel(c.dueAt, now); got != c.want {
			t.Errorf("dueLabel(%v) = %q want %q", time.UnixMilli(c.dueAt).In(models.FarmZone), got, c.want)
		}
	}
}

// --- stock usage ----------------------------------------------------------------

func TestStockUsageDeductsAndBooksCost(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)
	field := models.Field{FarmID: "f1", Name: "মাঠ ১", Crop: "টমেটো", Area: 10}
	item := models.StockItem{FarmID: "f1", Name: "পটাশ সার", Unit: "কেজি", Qty: 10, Min: 4}
	if err := db.Create(&field).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/stock/" + item.ID + "/usages"

	code, body := request(t, r, http.MethodPost, path, map[string]any{"qty": 3, "fieldId": field.ID, "cost": 450, "cat": "সার"})
	if code != http.StatusCreated {
		t.Fatalf("use stock = %d: %v", code, body)
	}
	if body["item"].(map[string]any)["qty"] != float64(7) {
		t.Fatalf("stock not reduced: %v", body)
	}
	led := body["ledger"].(map[string]any)
	if led["amount"] != float64(450) || led["type"] != "expense" || led["fieldId"] != field.ID {
		t.Fatalf("expense should be tagged to the field: %v", led)
	}
	// the expense shows in the per-field profit report
	_, rep := request(t, r, http.MethodGet, "/api/v1/reports/field-profit", nil)
	row := items(t, rep)[0].(map[string]any)
	if row["fieldId"] != field.ID || row["expense"] != float64(450) || row["profit"] != float64(-450) || row["profitPerShotok"] != float64(-45) {
		t.Fatalf("field profit row = %v", row)
	}

	// more than we have → 422; zero/negative → 400; unknown item → 404
	if code, _ := request(t, r, http.MethodPost, path, map[string]any{"qty": 99}); code != http.StatusUnprocessableEntity {
		t.Errorf("using more than stock = %d, want 422", code)
	}
	for _, q := range []any{0, -1} {
		if code, _ := request(t, r, http.MethodPost, path, map[string]any{"qty": q}); code != http.StatusBadRequest {
			t.Errorf("qty %v = %d, want 400", q, code)
		}
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/stock/nope/usages", map[string]any{"qty": 1}); code != http.StatusNotFound {
		t.Errorf("unknown item = %d, want 404", code)
	}

	// an operator may record usage but not book money
	if code, _ := requestWith(t, r, oper, http.MethodPost, path, map[string]any{"qty": 1}); code != http.StatusCreated {
		t.Errorf("operator usage without cost = %d, want 201", code)
	}
	if code, _ := requestWith(t, r, oper, http.MethodPost, path, map[string]any{"qty": 1, "cost": 10}); code != http.StatusForbidden {
		t.Errorf("operator usage with cost = %d, want 403", code)
	}

	// the shopping list now includes it: 6 left? 10-3-1 = 6 > min 4 → not low yet
	_, low := request(t, r, http.MethodGet, "/api/v1/stock?low=true", nil)
	if n := len(items(t, low)); n != 0 {
		t.Fatalf("not low yet: %v", low)
	}
	request(t, r, http.MethodPost, path, map[string]any{"qty": 2})
	_, low = request(t, r, http.MethodGet, "/api/v1/stock?low=true", nil)
	if n := len(items(t, low)); n != 1 { // at the minimum counts as low
		t.Fatalf("at-the-minimum item should be on the shopping list: %v", low)
	}
}

// --- fields: edit, crop templates, recommendations, market prices ---------------

func TestFieldPatchTemplatesAndRecommendations(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)
	field := models.Field{FarmID: "f1", Name: "মাঠ ১", Crop: "টমেটো", Area: 10, Plants: 50, HarvestAt: 90}
	if err := db.Create(&field).Error; err != nil {
		t.Fatal(err)
	}

	// edit keeps the id (and so its history); bad values are 400; operators cannot
	code, body := request(t, r, http.MethodPatch, "/api/v1/fields/"+field.ID, map[string]any{"area": 12.5, "zone": 1})
	if code != http.StatusOK || body["id"] != field.ID || body["area"] != 12.5 || body["zone"] != float64(1) {
		t.Fatalf("patch field = %d: %v", code, body)
	}
	_, body = request(t, r, http.MethodPatch, "/api/v1/fields/"+field.ID, map[string]any{"zone": -1})
	if _, linked := body["zone"]; linked {
		t.Fatalf("zone -1 should unlink: %v", body)
	}
	for _, bad := range []map[string]any{{"name": " "}, {"area": -1}, {"harvestAt": 0}} {
		if code, _ := request(t, r, http.MethodPatch, "/api/v1/fields/"+field.ID, bad); code != http.StatusBadRequest {
			t.Errorf("patch %v = %d, want 400", bad, code)
		}
	}
	if code, _ := requestWith(t, r, oper, http.MethodPatch, "/api/v1/fields/"+field.ID, map[string]any{"area": 1}); code != http.StatusForbidden {
		t.Errorf("operator field patch = %d, want 403", code)
	}
	if code, _ := request(t, r, http.MethodPatch, "/api/v1/fields/nope", map[string]any{"area": 1}); code != http.StatusNotFound {
		t.Errorf("unknown field = %d, want 404", code)
	}

	// templates are readable; planting one sets the crop and creates dated tasks
	_, body = request(t, r, http.MethodGet, "/api/v1/crop-templates", nil)
	if len(items(t, body)) < 5 {
		t.Fatalf("crop templates = %v", body)
	}
	code, body = request(t, r, http.MethodPost, "/api/v1/crop-templates/spinach/applications", map[string]any{"fieldId": field.ID})
	if code != http.StatusCreated {
		t.Fatalf("apply template = %d: %v", code, body)
	}
	f := body["field"].(map[string]any)
	if f["crop"] != "পালং শাক" || f["harvestAt"] != float64(40) {
		t.Fatalf("field after planting = %v", f)
	}
	tasks := body["tasks"].([]any)
	if len(tasks) != 3 || tasks[0].(map[string]any)["fieldId"] != field.ID {
		t.Fatalf("template tasks = %v", tasks)
	}
	// the day-0 job is due by the end of today (Dhaka) — not already overdue the moment it is planted
	first := int64(tasks[0].(map[string]any)["dueAt"].(float64))
	if first <= time.Now().UnixMilli() || time.UnixMilli(first).In(models.FarmZone).Format("15:04") != "23:59" {
		t.Fatalf("day-0 task should be due at 23:59 today, got %v", time.UnixMilli(first).In(models.FarmZone))
	}
	if tasks[0].(map[string]any)["due"] != "আজ" || tasks[2].(map[string]any)["dueAt"].(float64) <= float64(first) {
		t.Fatalf("labels/ordering of template tasks: %v", tasks)
	}
	_, list := request(t, r, http.MethodGet, "/api/v1/tasks?field="+field.ID, nil)
	if n := len(items(t, list)); n != 3 {
		t.Fatalf("tasks for the field = %d", n)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/crop-templates/nope/applications", map[string]any{"fieldId": field.ID}); code != http.StatusNotFound {
		t.Errorf("unknown template = %d, want 404", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/crop-templates/spinach/applications", map[string]any{"fieldId": "nope"}); code != http.StatusUnprocessableEntity {
		t.Errorf("unknown field = %d, want 422", code)
	}

	// market prices: owner writes, anyone reads, validation, filters
	if code, _ := requestWith(t, r, oper, http.MethodPost, "/api/v1/market-prices", map[string]any{"crop": "মুলা", "pricePerKg": 20}); code != http.StatusForbidden {
		t.Errorf("operator price write = %d, want 403", code)
	}
	for _, bad := range []map[string]any{{"crop": "মুলা"}, {"crop": "মুলা", "pricePerKg": 0}, {"pricePerKg": 5}} {
		if code, _ := request(t, r, http.MethodPost, "/api/v1/market-prices", bad); code != http.StatusBadRequest {
			t.Errorf("price %v = %d, want 400", bad, code)
		}
	}
	code, body = request(t, r, http.MethodPost, "/api/v1/market-prices", map[string]any{"crop": "মুলা", "pricePerKg": 20, "market": "কাওরান বাজার", "at": time.Now().Add(-2 * time.Hour).UnixMilli()})
	if code != http.StatusCreated {
		t.Fatalf("create price = %d: %v", code, body)
	}
	// a price "seen" in the future would outrank every real one
	if code, _ := request(t, r, http.MethodPost, "/api/v1/market-prices", map[string]any{"crop": "মুলা", "pricePerKg": 99, "at": time.Now().Add(time.Hour).UnixMilli()}); code != http.StatusBadRequest {
		t.Errorf("future price = %d, want 400", code)
	}
	request(t, r, http.MethodPost, "/api/v1/market-prices", map[string]any{"crop": "মুলা", "pricePerKg": 60, "at": time.Now().Add(-time.Hour).UnixMilli()})
	request(t, r, http.MethodPost, "/api/v1/market-prices", map[string]any{"crop": "বরবটি", "pricePerKg": 30})
	_, body = requestWith(t, r, oper, http.MethodGet, "/api/v1/market-prices?crop=মুলা", nil)
	if list := items(t, body); len(list) != 2 || list[0].(map[string]any)["pricePerKg"] != float64(60) {
		t.Fatalf("prices (newest first) = %v", list)
	}

	// recommendations: ranked, with reasons, and the price book shows up
	code, body = requestWith(t, r, oper, http.MethodGet, "/api/v1/fields/"+field.ID+"/recommendations?month=11", nil)
	if code != http.StatusOK {
		t.Fatalf("recommendations = %d: %v", code, body)
	}
	ranked := items(t, body)
	top := ranked[0].(map[string]any)
	if len(top["reasons"].([]any)) != 4 || top["score"].(float64) < ranked[len(ranked)-1].(map[string]any)["score"].(float64) {
		t.Fatalf("ranking = %v", top)
	}
	if body["crop"] != "পালং শাক" {
		t.Fatalf("recommendations should use the field's current crop: %v", body)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/fields/"+field.ID+"/recommendations?month=13", nil); code != http.StatusBadRequest {
		t.Errorf("month 13 = %d, want 400", code)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/fields/nope/recommendations", nil); code != http.StatusNotFound {
		t.Errorf("unknown field = %d, want 404", code)
	}

	// disease notes on the field are linked and counted
	if code, _ := request(t, r, http.MethodPost, "/api/v1/observations", map[string]any{"kind": "রোগ", "note": "পাতা পোড়া", "fieldId": field.ID}); code != http.StatusCreated {
		t.Fatalf("observation with field = %d", code)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/observations", map[string]any{"kind": "রোগ", "note": "x", "fieldId": "nope"}); code != http.StatusUnprocessableEntity {
		t.Errorf("observation unknown field = %d, want 422", code)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/observations?field="+field.ID, nil)
	if n := len(items(t, body)); n != 1 {
		t.Fatalf("observations for the field = %d", n)
	}
}

// --- farm safety limit, profile contacts, weekly summary -------------------------

func TestDailyLimitSettingContactsAndWeeklySummary(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)

	// maxDailyMinutes: owner only, 0..1440, visible in the snapshot
	if code, _ := requestWith(t, r, oper, http.MethodPatch, "/api/v1/farm", map[string]any{"maxDailyMinutes": 60}); code != http.StatusForbidden {
		t.Errorf("operator limit = %d, want 403", code)
	}
	if code, _ := request(t, r, http.MethodPatch, "/api/v1/farm", map[string]any{"maxDailyMinutes": 2000}); code != http.StatusBadRequest {
		t.Errorf("limit 2000 = %d, want 400", code)
	}
	code, body := request(t, r, http.MethodPatch, "/api/v1/farm", map[string]any{"maxDailyMinutes": 90})
	if code != http.StatusOK || body["maxDailyMinutes"] != float64(90) {
		t.Fatalf("set limit = %d: %v", code, body)
	}

	// own contacts: anyone for themselves, validated; owner can set another user's
	code, body = requestWith(t, r, oper, http.MethodPatch, "/api/v1/auth/me", map[string]any{"phone": "+8801712345678", "telegramChat": "-1001234567"})
	if code != http.StatusOK || body["phone"] != "+8801712345678" {
		t.Fatalf("patch me = %d: %v", code, body)
	}
	for _, bad := range []map[string]any{{"phone": "123"}, {"phone": "০১৭১২"}, {"telegramChat": "abc"}, {"name": " "}} {
		if code, _ := requestWith(t, r, oper, http.MethodPatch, "/api/v1/auth/me", bad); code != http.StatusBadRequest {
			t.Errorf("patch me %v = %d, want 400", bad, code)
		}
	}
	// regression: saving contacts must not touch the password — logging in again still works,
	// and /auth/me now reports the saved contacts
	if code, body := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{"email": "oper@farm.com", "password": "farm123"}); code != http.StatusOK {
		t.Fatalf("login after saving contacts = %d: %v (the profile save must not wipe the password hash)", code, body)
	}
	if code, body := requestWith(t, r, oper, http.MethodGet, "/api/v1/auth/me", nil); code != http.StatusOK || body["phone"] != "+8801712345678" || body["telegramChat"] != "-1001234567" {
		t.Fatalf("auth/me after saving = %d: %v", code, body)
	}
	var u models.User
	db.First(&u, "email = ?", "oper@farm.com")
	if code, body := request(t, r, http.MethodPatch, "/api/v1/users/"+u.ID, map[string]any{"phone": ""}); code != http.StatusOK || body["phone"] != "" {
		t.Errorf("owner clearing a phone = %d: %v", code, body)
	}

	// weekly summary reflects the week's rows
	now := time.Now().UnixMilli()
	db.Create(&models.LedgerEntry{FarmID: "f1", At: now, Type: "income", Cat: "বিক্রি", Amount: 1000})
	db.Create(&models.LedgerEntry{FarmID: "f1", At: now, Type: "expense", Cat: "সার", Amount: 300})
	db.Create(&models.LedgerEntry{FarmID: "f1", At: now - 30*24*3_600_000, Type: "expense", Cat: "পুরোনো", Amount: 9999})
	db.Create(&models.PumpRun{FarmID: "f1", Start: now - 3_600_000, End: now - 1_800_000, Litres: 500, Source: "pump"})
	db.Create(&models.Task{FarmID: "f1", Text: "বাকি", Who: "আমি", Due: "আজ", DueAt: now - 1000})
	db.Create(&models.StockItem{FarmID: "f1", Name: "বীজ", Unit: "প্যাকেট", Qty: 1, Min: 2})
	code, body = requestWith(t, r, oper, http.MethodGet, "/api/v1/reports/weekly-summary", nil)
	if code != http.StatusOK || body["income"] != float64(1000) || body["expense"] != float64(300) ||
		body["litres"] != float64(500) || body["pumpRuns"] != float64(1) ||
		body["openTasks"] != float64(1) || body["overdueTasks"] != float64(1) {
		t.Fatalf("weekly summary = %d: %v", code, body)
	}
	if low := body["lowStock"].([]any); len(low) != 1 || low[0] != "বীজ" {
		t.Fatalf("lowStock = %v", body["lowStock"])
	}
}

// --- offline replay: client ids and timestamps ---------------------------------------

// A queued write may be sent twice (the first answer was lost). With a client id the
// second insert must be a 409 and leave exactly one row — never a duplicate.
func TestReplayedCreatesAreIdempotent(t *testing.T) {
	r, db := testDB(t)
	now := time.Now()
	madeAt := now.Add(-3 * time.Hour).UnixMilli()

	cases := []struct {
		name, path, table string
		body              map[string]any
	}{
		{"task", "/api/v1/tasks", "tasks", map[string]any{"id": "offline-task-1", "text": "পানি", "who": "আমি", "due": "আজ"}},
		{"ledger", "/api/v1/ledger", "ledger_entries", map[string]any{"id": "offline-led-01", "type": "expense", "cat": "সার", "amount": 50, "at": madeAt}},
		{"observation", "/api/v1/observations", "observations", map[string]any{"id": "offline-obs-01", "kind": "পোকা", "note": "ছিদ্র", "at": madeAt}},
	}
	for _, c := range cases {
		code, body := request(t, r, http.MethodPost, c.path, c.body)
		if code != http.StatusCreated || body["id"] != c.body["id"] {
			t.Fatalf("%s first send = %d: %v (the client id must become the row id)", c.name, code, body)
		}
		if at, ok := c.body["at"]; ok && body["at"] != float64(at.(int64)) {
			t.Fatalf("%s should keep the time it was made, got %v want %v", c.name, body["at"], at)
		}
		if code, _ := request(t, r, http.MethodPost, c.path, c.body); code != http.StatusConflict {
			t.Errorf("%s replay = %d, want 409", c.name, code)
		}
		var n int64
		db.Table(c.table).Where("id = ?", c.body["id"]).Count(&n)
		if n != 1 {
			t.Errorf("%s rows after replay = %d, want exactly 1", c.name, n)
		}
	}

	// bad ids and out-of-range times are 400, not silently accepted
	for _, bad := range []map[string]any{
		{"id": "x", "type": "expense", "cat": "সার", "amount": 5},                                 // too short
		{"id": "has space!", "type": "expense", "cat": "সার", "amount": 5},                        // bad characters
		{"type": "expense", "cat": "সার", "amount": 5, "at": now.Add(time.Hour).UnixMilli()},      // future
		{"type": "expense", "cat": "সার", "amount": 5, "at": now.AddDate(0, 0, -200).UnixMilli()}, // too old
	} {
		if code, body := request(t, r, http.MethodPost, "/api/v1/ledger", bad); code != http.StatusBadRequest {
			t.Errorf("ledger %v = %d: %v, want 400", bad, code, body)
		}
	}
	// without id/at the server picks both, as before
	code, body := request(t, r, http.MethodPost, "/api/v1/tasks", map[string]any{"text": "সাধারণ", "who": "আমি", "due": "আজ"})
	if code != http.StatusCreated || len(body["id"].(string)) < 6 {
		t.Fatalf("plain create = %d: %v", code, body)
	}
}

func TestClientTimeAndID(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	if got, err := clientTime(0, now); err != nil || got != now.UnixMilli() {
		t.Fatalf("0 means now: %v %v", got, err)
	}
	if _, err := clientTime(now.Add(4*time.Minute).UnixMilli(), now); err != nil {
		t.Fatalf("a little clock skew is fine: %v", err)
	}
	if _, err := clientTime(now.Add(6*time.Minute).UnixMilli(), now); err == nil {
		t.Fatal("the future is rejected")
	}
	if _, err := clientTime(now.AddDate(0, 0, -91).UnixMilli(), now); err == nil {
		t.Fatal("older than 90 days is rejected")
	}
	for id, ok := range map[string]bool{"": true, "abc123": true, "a1b2c3d4-e5f6": true, "short": false, "bad id!": false} {
		if (checkClientID(id) == nil) != ok {
			t.Errorf("checkClientID(%q) ok=%v, want %v", id, !ok, ok)
		}
	}
}
