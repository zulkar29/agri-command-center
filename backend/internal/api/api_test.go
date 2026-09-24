package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/testutil"
)

// These are integration tests against a real PostgreSQL: set
// TEST_DATABASE_URL (e.g. postgres://farm:farm-dev-password@localhost:5433/
// farmdb_test?sslmode=disable) and they run; without it they skip. The docker
// compose stack exposes Postgres for exactly this.
//
// Every test runs logged in: testDB seeds a user, logs in and leaves the
// token in testToken, which request() attaches as the bearer header. The
// auth tests drive requestWith directly with their own tokens.
var testToken string

const testEmail = "owner@farm.com"

func testDB(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := testutil.OpenDB(t, "api_test")

	farm := models.Farm{
		ID: "f1", Slug: "test-farm", Name: "টেস্ট ফার্ম", Mode: "manual",
		Threshold: 35, Duration: 10, Tank: 60,
		Moist: []float64{40, 41, 42}, Valves: []bool{true, false, true},
	}
	if err := db.Create(&farm).Error; err != nil {
		t.Fatalf("seed farm: %v", err)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("farm123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user := models.User{Name: "আপনি", Email: testEmail, PasswordHash: string(hash), Role: "মালিক"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}

	r := NewRouter(db, "", AuthOptions{JWTSecret: []byte("test-secret-not-for-prod")}, nil, nil)
	code, body := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": testEmail, "password": "farm123",
	})
	if code != http.StatusOK {
		t.Fatalf("test login = %d: %v", code, body)
	}
	testToken = body["token"].(string)
	return r, db
}

// requestWith runs one HTTP call with an explicit bearer token ("" = none)
// and decodes the JSON body.
func requestWith(t *testing.T, r *gin.Engine, token, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rd = bytes.NewReader(raw)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

// request is requestWith with the shared login token.
func request(t *testing.T, r *gin.Engine, method, path string, body any) (int, map[string]any) {
	t.Helper()
	return requestWith(t, r, testToken, method, path, body)
}

func items(t *testing.T, body map[string]any) []any {
	t.Helper()
	raw, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("response has no items array: %v", body)
	}
	return raw
}

func getFloat(t *testing.T, body map[string]any, key string) float64 {
	t.Helper()
	v, ok := body[key].(float64)
	if !ok {
		t.Fatalf("response field %q is not a number: %v", key, body)
	}
	return v
}

func TestAuthFlow(t *testing.T) {
	r, _ := testDB(t)

	// no token → every protected route is closed, including the snapshot
	if code, _ := requestWith(t, r, "", http.MethodGet, "/api/v1/farm", nil); code != http.StatusUnauthorized {
		t.Errorf("farm without token = %d, want 401", code)
	}
	// garbage bearer (not a JWT) and garbage JWT both fail signature checks
	if code, _ := requestWith(t, r, "deadbeef", http.MethodGet, "/api/v1/tasks", nil); code != http.StatusUnauthorized {
		t.Errorf("tasks with unknown token = %d, want 401", code)
	}
	if code, _ := requestWith(t, r, "eyJhbGciOiJIUzI1NiJ9.e30.funnybusiness", http.MethodGet, "/api/v1/tasks", nil); code != http.StatusUnauthorized {
		t.Errorf("tasks with forged JWT = %d, want 401", code)
	}
	// the open set stays open
	if code, _ := requestWith(t, r, "", http.MethodGet, "/api/health", nil); code != http.StatusOK {
		t.Errorf("health = %d, want 200", code)
	}
	// refresh carries its own credential — a wrong one is rejected
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refreshToken": "x"}); code != http.StatusUnauthorized {
		t.Errorf("refresh with unknown token = %d, want 401", code)
	}

	// wrong password and unknown email both say the same thing
	code, body := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": testEmail, "password": "wrong",
	})
	if code != http.StatusUnauthorized {
		t.Errorf("login wrong password = %d: %v", code, body)
	}
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "ghost@farm.com", "password": "farm123",
	}); code != http.StatusUnauthorized {
		t.Errorf("login unknown email = %d, want 401", code)
	}
	// malformed login → 400
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "not-an-email", "password": "",
	}); code != http.StatusBadRequest {
		t.Errorf("malformed login = %d, want 400", code)
	}

	// happy path: user (no password hash leak) + JWT access + refresh token
	code, body = requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": "Owner@Farm.com", "password": "farm123",
	})
	if code != http.StatusOK {
		t.Fatalf("login = %d: %v", code, body)
	}
	user, _ := body["user"].(map[string]any)
	if user["email"] != testEmail || user["role"] != "মালিক" {
		t.Errorf("login user = %v, want the seeded owner", user)
	}
	if _, leak := user["passwordHash"]; leak {
		t.Errorf("login response leaks the password hash: %v", user)
	}
	token, _ := body["token"].(string)
	refresh, _ := body["refreshToken"].(string)
	if len(refresh) != 64 {
		t.Errorf("refresh token %q is %d chars, want 64 hex", refresh, len(refresh))
	}
	if parts := strings.Count(token, "."); parts != 2 {
		t.Errorf("access token %q has %d dots, want a JWT (2)", token, parts)
	}
	if code, body := requestWith(t, r, token, http.MethodGet, "/api/v1/auth/me", nil); code != http.StatusOK {
		t.Errorf("me with fresh token = %d, want 200", code)
	} else if me, _ := body["email"].(string); me != testEmail {
		t.Errorf("me = %v, want claims-based user", body)
	}

	// refresh rotates: new pair works, the old refresh token is dead
	code, body = requestWith(t, r, "", http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refreshToken": refresh})
	if code != http.StatusOK {
		t.Fatalf("refresh = %d: %v", code, body)
	}
	refresh2, _ := body["refreshToken"].(string)
	token2, _ := body["token"].(string)
	if refresh2 == refresh {
		t.Errorf("refresh did not rotate the token")
	}
	if code, _ := requestWith(t, r, token2, http.MethodGet, "/api/v1/farm", nil); code != http.StatusOK {
		t.Errorf("farm with refreshed access = %d, want 200", code)
	}
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refreshToken": refresh}); code != http.StatusUnauthorized {
		t.Errorf("old refresh token after rotation = %d, want 401", code)
	}

	// logout revokes the refresh session; the access JWT stays valid until
	// it expires (stateless — there is no blocklist, TTL is 15 min)
	if code, _ := requestWith(t, r, token2, http.MethodPost, "/api/v1/auth/logout", map[string]any{"refreshToken": refresh2}); code != http.StatusNoContent {
		t.Errorf("logout = %d, want 204", code)
	}
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/refresh", map[string]any{"refreshToken": refresh2}); code != http.StatusUnauthorized {
		t.Errorf("refresh after logout = %d, want 401", code)
	}
	if code, _ := requestWith(t, r, token2, http.MethodGet, "/api/v1/auth/me", nil); code != http.StatusOK {
		t.Errorf("access token after logout = %d, want 200 until it ages out (stateless)", code)
	}
	// …while the testToken session (a second login) still works
	if code, _ := request(t, r, http.MethodGet, "/api/v1/farm", nil); code != http.StatusOK {
		t.Errorf("farm with the other session = %d, want 200", code)
	}
}

// loginAs seeds a user with the given role and returns a fresh access token.
func loginAs(t *testing.T, r *gin.Engine, db *gorm.DB, email, role string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("farm123"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	user := models.User{Name: email, Email: email, PasswordHash: string(hash), Role: role}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed %s: %v", email, err)
	}
	code, body := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email": email, "password": "farm123",
	})
	if code != http.StatusOK {
		t.Fatalf("login %s = %d: %v", email, code, body)
	}
	return body["token"].(string)
}

// The documented matrix: মালিক everything, অপারেটর সেচ+কাজ+স্কাউট+ডিভাইস,
// দর্শক read-only. Reads stay open to every role; writes 403 politely.
func TestRolePermissions(t *testing.T) {
	r, db := testDB(t)
	oper := loginAs(t, r, db, "oper@farm.com", models.RoleOperator)
	viewer := loginAs(t, r, db, "viewer@farm.com", models.RoleViewer)

	task := map[string]any{"text": "কাজ", "who": "বাবা", "due": "আজ"}
	field := map[string]any{"name": "মাঠ", "crop": "টমেটো", "area": 5, "plants": 50, "harvestAt": 70}
	ledger := map[string]any{"type": "income", "cat": "বিক্রি", "amount": 100}
	if err := db.Create(&models.Device{ID: "pump-relay-1", FarmID: "f1", Kind: "relay", Metrics: map[string]float64{}}).Error; err != nil {
		t.Fatalf("seed device: %v", err)
	}

	// reads: every role
	for _, tok := range []string{oper, viewer} {
		if code, _ := requestWith(t, r, tok, http.MethodGet, "/api/v1/farm", nil); code != http.StatusOK {
			t.Errorf("farm read (%s) = %d, want 200", shortRole(tok), code)
		}
		if code, _ := requestWith(t, r, tok, http.MethodGet, "/api/v1/tasks", nil); code != http.StatusOK {
			t.Errorf("tasks read (%s) = %d, want 200", shortRole(tok), code)
		}
	}

	// operator: irrigation + tasks + scout + device commands
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "on"}},
		{http.MethodPost, "/api/v1/farm/waterings", map[string]any{"zones": []int{0}}},
		{http.MethodPost, "/api/v1/tasks", task},
		{http.MethodPost, "/api/v1/observations", map[string]any{"kind": "ঠিক আছে", "note": "দেখলাম"}},
		{http.MethodPost, "/api/v1/devices/pump-relay-1/commands", map[string]any{"command": "on"}},
	} {
		if code, body := requestWith(t, r, oper, tc.method, tc.path, tc.body); code != http.StatusOK && code != http.StatusCreated {
			t.Errorf("operator %s %s = %d: %v, want 2xx", tc.method, tc.path, code, body)
		}
	}
	// operator may patch irrigation fields on the farm…
	if code, body := requestWith(t, r, oper, http.MethodPatch, "/api/v1/farm", map[string]any{"valves": []bool{false, false, false}}); code != http.StatusOK {
		t.Errorf("operator patch valves = %d: %v, want 200", code, body)
	}
	// …but not the owner-only setup fields, nor money/land/inventory
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPatch, "/api/v1/farm", map[string]any{"farmName": "নতুন নাম"}},
		{http.MethodPost, "/api/v1/fields", field},
		{http.MethodPost, "/api/v1/ledger", ledger},
		{http.MethodPost, "/api/v1/stock", map[string]any{"name": "সার", "unit": "কেজি", "qty": 1, "min": 1}},
	} {
		if code, _ := requestWith(t, r, oper, tc.method, tc.path, tc.body); code != http.StatusForbidden {
			t.Errorf("operator %s %s = %d, want 403", tc.method, tc.path, code)
		}
	}

	// viewer: every write is 403, reads still fine
	for _, tc := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "on"}},
		{http.MethodPatch, "/api/v1/farm", map[string]any{"valves": []bool{true, true, true}}},
		{http.MethodPost, "/api/v1/tasks", task},
		{http.MethodPost, "/api/v1/observations", map[string]any{"kind": "ঠিক আছে", "note": "x"}},
		{http.MethodPost, "/api/v1/schedules", map[string]any{"time": "07:00", "dur": 10, "zone": "সব জোন"}},
		{http.MethodPost, "/api/v1/devices/pump-relay-1/commands", map[string]any{"command": "on"}},
		{http.MethodPost, "/api/v1/fields", field},
		{http.MethodPost, "/api/v1/ledger", ledger},
	} {
		if code, body := requestWith(t, r, viewer, tc.method, tc.path, tc.body); code != http.StatusForbidden {
			t.Errorf("viewer %s %s = %d: %v, want 403", tc.method, tc.path, code, body)
		}
	}
	if _, body := requestWith(t, r, viewer, http.MethodPut, "/api/v1/farm/pump", map[string]any{"state": "on"}); body["error"] != "এই কাজের অনুমতি আপনার ভূমিকার (দর্শক) নেই।" {
		t.Errorf("403 message = %v, want the role-aware Bengali message", body["error"])
	}

	// owner: the operator-forbidden writes succeed (testDB logs in as owner)
	if code, body := requestWith(t, r, testToken, http.MethodPost, "/api/v1/ledger", ledger); code != http.StatusCreated {
		t.Errorf("owner POST ledger = %d: %v, want 201", code, body)
	}
	if code, body := requestWith(t, r, testToken, http.MethodPatch, "/api/v1/farm", map[string]any{"farmName": "নতুন নাম"}); code != http.StatusOK {
		t.Errorf("owner patch farmName = %d: %v, want 200", code, body)
	}
}

func shortRole(jwt string) string {
	if len(jwt) > 12 {
		return "token…" + jwt[8:12]
	}
	return jwt
}

func TestGoogleLoginDisabledWithoutClientID(t *testing.T) {
	r, _ := testDB(t)

	code, body := requestWith(t, r, "", http.MethodGet, "/api/v1/auth/config", nil)
	if code != http.StatusOK {
		t.Fatalf("auth config = %d: %v", code, body)
	}
	if id, _ := body["googleClientId"].(string); id != "" {
		t.Errorf("googleClientId = %q, want empty (not configured)", id)
	}
	// without GOOGLE_CLIENT_ID the endpoint refuses instead of half-working
	if code, _ := requestWith(t, r, "", http.MethodPost, "/api/v1/auth/google", map[string]any{
		"idToken": "whatever",
	}); code != http.StatusServiceUnavailable {
		t.Errorf("google login unconfigured = %d, want 503", code)
	}
}

func TestFarmSnapshotIsControlOnly(t *testing.T) {
	r, db := testDB(t)
	db.Create(&models.Task{FarmID: "f1", Text: "কাজ", Who: "আমি", Due: "আজ"})
	db.Create(&models.LedgerEntry{FarmID: "f1", At: 1, Type: "income", Cat: "বিক্রি", Amount: 10})

	code, body := request(t, r, http.MethodGet, "/api/v1/farm", nil)
	if code != http.StatusOK {
		t.Fatalf("GET /api/v1/farm = %d: %v", code, body)
	}
	// control state present (moist/valves come straight from the farm row)…
	for _, k := range []string{"farmName", "mode", "pumpOn", "threshold", "duration", "moist", "valves", "tank", "humidity", "temp", "volt", "rules", "irrLog", "notif", "team"} {
		if _, ok := body[k]; !ok {
			t.Errorf("snapshot missing control key %q", k)
		}
	}
	if moist, _ := body["moist"].([]any); len(moist) != 3 {
		t.Errorf("moist = %v, want the 3 seeded zones", moist)
	}
	// …collections consolidated onto their own endpoints, not embedded
	for _, k := range []string{"tasks", "ledger", "stock", "fields", "scout", "schedules"} {
		if _, ok := body[k]; ok {
			t.Errorf("snapshot must not embed collection %q (it has its own endpoint)", k)
		}
	}
}

func TestPatchFarmValves(t *testing.T) {
	r, _ := testDB(t)

	// valves replace wholesale and round-trip through the JSON serializer
	code, body := request(t, r, http.MethodPatch, "/api/v1/farm", map[string]any{
		"valves": []bool{false, false, false},
	})
	if code != http.StatusOK {
		t.Fatalf("PATCH valves = %d: %v", code, body)
	}
	if valves, _ := body["valves"].([]any); len(valves) != 3 || valves[0] != false {
		t.Errorf("valves after patch = %v, want [false false false]", valves)
	}

	// empty valves rejected
	if code, _ = request(t, r, http.MethodPatch, "/api/v1/farm", map[string]any{
		"valves": []bool{},
	}); code != http.StatusBadRequest {
		t.Errorf("empty valves = %d, want 400", code)
	}
}

func TestRulesPatchReturnsSnapshot(t *testing.T) {
	r, db := testDB(t)
	rule := models.Rule{FarmID: "f1", Text: "ট্যাংক কম হলে পাম্প বন্ধ", On: true}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("seed rule: %v", err)
	}

	code, body := request(t, r, http.MethodPatch, "/api/v1/rules/"+rule.ID, map[string]any{"on": false})
	if code != http.StatusOK {
		t.Fatalf("PATCH rule = %d: %v", code, body)
	}
	// the answer is the control snapshot so clients hydrate without a refetch
	for _, k := range []string{"farmName", "moist", "rules"} {
		if _, ok := body[k]; !ok {
			t.Errorf("rule patch response missing snapshot key %q", k)
		}
	}
	if rules, _ := body["rules"].([]any); len(rules) != 1 {
		t.Errorf("rules in snapshot = %d, want 1", len(rules))
	}
}

func TestTasksPaginationAndFilters(t *testing.T) {
	r, db := testDB(t)
	base := time.Now().Add(-time.Hour)
	for i := 0; i < 7; i++ {
		task := models.Task{
			FarmID: "f1", Text: fmt.Sprintf("সেচ দিন %d", i), Who: "বাবা", Due: "আজ",
			Urgent: i == 0, Done: i < 2, CreatedAt: base.Add(time.Duration(i) * time.Minute),
		}
		if i == 6 {
			task.Text, task.Who, task.Due = "সার দিন", "শ্রমিক", "কাল"
		}
		if err := db.Create(&task).Error; err != nil {
			t.Fatalf("seed task: %v", err)
		}
	}

	// page 2 of 3-per-page: total 7, 3 pages, 3 items
	code, body := request(t, r, http.MethodGet, "/api/v1/tasks?limit=3&page=2", nil)
	if code != http.StatusOK {
		t.Fatalf("list tasks = %d: %v", code, body)
	}
	if got := getFloat(t, body, "total"); got != 7 {
		t.Errorf("total = %v, want 7", got)
	}
	if got := getFloat(t, body, "pages"); got != 3 {
		t.Errorf("pages = %v, want 3", got)
	}
	if got := len(items(t, body)); got != 3 {
		t.Errorf("page 2 has %d items, want 3", got)
	}
	// newest first: page 1 item 0 is the latest-created task
	code, body = request(t, r, http.MethodGet, "/api/v1/tasks?limit=3", nil)
	if code != http.StatusOK {
		t.Fatalf("list tasks page 1 = %d: %v", code, body)
	}
	if txt, _ := items(t, body)[0].(map[string]any)["text"].(string); txt != "সার দিন" {
		t.Errorf("first task = %q, want the newest (সার দিন)", txt)
	}

	// done=false → the 5 unfinished
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?done=false", nil)
	if got := getFloat(t, body, "total"); got != 5 {
		t.Errorf("done=false total = %v, want 5", got)
	}
	// urgent=true → 1
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?urgent=true", nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("urgent=true total = %v, want 1", got)
	}
	// q= matches text substring (সার দিন, not the সেচ দিন rows)
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?q=সার", nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("q=সার total = %v, want 1", got)
	}
	// due=কাল → 1
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?due=কাল", nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("due=কাল total = %v, want 1", got)
	}
	// who search via q
	_, body = request(t, r, http.MethodGet, "/api/v1/tasks?q=শ্রমিক", nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("q=শ্রমিক total = %v, want 1", got)
	}
	// invalid pagination → 400
	if code, _ = request(t, r, http.MethodGet, "/api/v1/tasks?page=0", nil); code != http.StatusBadRequest {
		t.Errorf("page=0 = %d, want 400", code)
	}
	if code, _ = request(t, r, http.MethodGet, "/api/v1/tasks?limit=999", nil); code != http.StatusBadRequest {
		t.Errorf("limit=999 = %d, want 400", code)
	}
	if code, _ = request(t, r, http.MethodGet, "/api/v1/tasks?done=maybe", nil); code != http.StatusBadRequest {
		t.Errorf("done=maybe = %d, want 400", code)
	}
	if code, _ = request(t, r, http.MethodGet, "/api/v1/tasks?due=গতকাল", nil); code != http.StatusBadRequest {
		t.Errorf("due=গতকাল = %d, want 400", code)
	}
}

func TestLedgerFilters(t *testing.T) {
	r, db := testDB(t)
	now := time.Now().UnixMilli()
	rows := []models.LedgerEntry{
		{FarmID: "f1", At: now - 30000, Type: "income", Cat: "ধান বিক্রি", Amount: 5000, Note: "পাইকারি"},
		{FarmID: "f1", At: now - 20000, Type: "expense", Cat: "সার", Amount: 800, Note: "ইউরিয়া"},
		{FarmID: "f1", At: now - 10000, Type: "income", Cat: "সবজি বিক্রি", Amount: 1200, Note: "পাইকারি"},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatalf("seed ledger: %v", err)
		}
	}

	_, body := request(t, r, http.MethodGet, "/api/v1/ledger?type=income", nil)
	if got := getFloat(t, body, "total"); got != 2 {
		t.Errorf("type=income total = %v, want 2", got)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/ledger?q=পাইকারি", nil)
	if got := getFloat(t, body, "total"); got != 2 {
		t.Errorf("q=পাইকারি total = %v, want 2", got)
	}
	_, body = request(t, r, http.MethodGet, fmt.Sprintf("/api/v1/ledger?from=%d&to=%d", now-25000, now-15000), nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("from/to window total = %v, want 1", got)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/ledger?type=loan", nil); code != http.StatusBadRequest {
		t.Errorf("type=loan = %d, want 400", code)
	}
}

func TestTelemetryIngestAndPaging(t *testing.T) {
	r, _ := testDB(t)

	code, body := request(t, r, http.MethodPost, "/api/v1/telemetry", map[string]any{
		"farm": "test-farm", "node": "esp32-1", "soil_moisture": []float64{40, 41, 42},
		"air_temp": 28, "air_humidity": 75, "tank_level": 65, "battery_v": 12.5,
	})
	if code != http.StatusCreated {
		t.Fatalf("ingest = %d: %v", code, body)
	}
	if code, _ := request(t, r, http.MethodPost, "/api/v1/telemetry", map[string]any{
		"node": "esp32-2", "soil_moisture": []float64{50},
	}); code != http.StatusCreated {
		t.Fatalf("ingest without farm slug = %d (slug is optional, farm inferred)", code)
	}

	// ingest refreshed the farm's live state: esp32-1 wrote [40,41,42], then
	// esp32-2's [50] overwrote zone 0 — one row, no zone table
	_, farmBody := request(t, r, http.MethodGet, "/api/v1/farm", nil)
	moist, _ := farmBody["moist"].([]any)
	if len(moist) != 3 || moist[0] != float64(50) || moist[1] != float64(41) {
		t.Errorf("farm moist after ingests = %v, want [50 41 42]", moist)
	}

	_, body = request(t, r, http.MethodGet, "/api/v1/telemetry?hours=1&limit=1", nil)
	if got := getFloat(t, body, "total"); got != 2 {
		t.Errorf("telemetry total = %v, want 2", got)
	}
	if got := len(items(t, body)); got != 1 {
		t.Errorf("limit=1 returned %d items, want 1", got)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/telemetry?hours=1&node=esp32-2", nil)
	rows := items(t, body)
	if len(rows) != 1 {
		t.Fatalf("node filter returned %d rows, want 1", len(rows))
	}
	if node, _ := rows[0].(map[string]any)["node"].(string); node != "esp32-2" {
		t.Errorf("node filter returned node %q", node)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/telemetry?hours=0", nil); code != http.StatusBadRequest {
		t.Errorf("hours=0 = %d, want 400", code)
	}
}

func TestDevicesFilters(t *testing.T) {
	r, db := testDB(t)
	seed := []models.Device{
		{ID: "gw-1", FarmID: "f1", Kind: "gateway", Online: true, Metrics: map[string]float64{}},
		{ID: "pump-relay-1", FarmID: "f1", Kind: "relay", Online: true, Metrics: map[string]float64{"state": 1}},
		{ID: "esp32-1", FarmID: "f1", Kind: "sensor", Online: false, Metrics: map[string]float64{}},
	}
	for i := range seed {
		if err := db.Create(&seed[i]).Error; err != nil {
			t.Fatalf("seed device: %v", err)
		}
	}

	_, body := request(t, r, http.MethodGet, "/api/v1/devices?kind=relay", nil)
	if got := getFloat(t, body, "total"); got != 1 {
		t.Errorf("kind=relay total = %v, want 1", got)
	}
	_, body = request(t, r, http.MethodGet, "/api/v1/devices?online=true", nil)
	if got := getFloat(t, body, "total"); got != 2 {
		t.Errorf("online=true total = %v, want 2", got)
	}
	if code, _ := request(t, r, http.MethodGet, "/api/v1/devices?kind=robot", nil); code != http.StatusBadRequest {
		t.Errorf("kind=robot = %d, want 400", code)
	}
}

// postTelemetry posts one reading with an X-Device-Key header (no bearer
// token — devices are not users) and returns the status code.
func postTelemetry(t *testing.T, r *gin.Engine, key string, body any) int {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/telemetry", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("X-Device-Key", key)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}
