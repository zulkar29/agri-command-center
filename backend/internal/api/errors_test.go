package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The clients show {"error"} to users as-is, so input errors must be Bengali
// that names the JSON field — never gin's "Key: 'createTaskReq.Text' …".

func rawRequest(r http.Handler, method, path, body string) (*httptest.ResponseRecorder, string) {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out struct{ Error string }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w, out.Error
}

func TestInputErrorsAreBengaliAndNameJSONFields(t *testing.T) {
	r, _ := testDB(t)

	cases := []struct {
		name, body string
		want       []string
	}{
		{"missing fields", `{}`, []string{"ইনপুট ঠিক নেই", "text দিতে হবে", "who দিতে হবে"}},
		{"wrong type", `{"text":5,"who":"বাবা"}`, []string{"ইনপুট ঠিক নেই", "text", "string"}},
		{"not JSON", `garbage`, []string{"JSON ঠিক নেই"}},
		{"empty body", ``, []string{"JSON ঠিক নেই"}},
	}
	for _, tc := range cases {
		w, msg := rawRequest(r, http.MethodPost, "/api/v1/tasks", tc.body)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", tc.name, w.Code)
		}
		for _, s := range tc.want {
			if !strings.Contains(msg, s) {
				t.Errorf("%s: error %q lacks %q", tc.name, msg, s)
			}
		}
		if strings.Contains(msg, "Key: '") || strings.Contains(msg, "Req.") {
			t.Errorf("%s: error leaks Go names: %q", tc.name, msg)
		}
	}

	// query parameter errors share the same voice
	w, msg := rawRequest(r, http.MethodGet, "/api/v1/tasks?page=abc", "")
	if w.Code != http.StatusBadRequest || !strings.HasPrefix(msg, "ইনপুট ঠিক নেই: page") {
		t.Errorf("bad page = %d %q", w.Code, msg)
	}
}

func TestOversizedBodyIs413(t *testing.T) {
	r, _ := testDB(t)
	huge := `{"text":"` + strings.Repeat("x", maxBodyBytes) + `","who":"বাবা"}`
	w, msg := rawRequest(r, http.MethodPost, "/api/v1/tasks", huge)
	if w.Code != http.StatusRequestEntityTooLarge || msg == "" {
		t.Fatalf("oversized body = %d %q, want 413 with an error", w.Code, msg)
	}
}

func TestUnauthorizedCarriesChallenge(t *testing.T) {
	r, _ := testDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/farm", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || !strings.HasPrefix(w.Header().Get("WWW-Authenticate"), "Bearer") {
		t.Errorf("no token = %d, WWW-Authenticate %q", w.Code, w.Header().Get("WWW-Authenticate"))
	}

	body, _ := json.Marshal(map[string]any{"email": testEmail, "password": "wrong"})
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized || w.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("bad login = %d, WWW-Authenticate %q", w.Code, w.Header().Get("WWW-Authenticate"))
	}
}

// Without a weather client the feature is off on this server (503), which is
// not the farm's fault; a missing farm location stays 422.
func TestWeatherDisabledIs503(t *testing.T) {
	r, _ := testDB(t)
	if code, body := request(t, r, http.MethodGet, "/api/v1/weather", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("weather without client = %d %v, want 503", code, body)
	}
}
