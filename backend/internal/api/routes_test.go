package api

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// These tests need no database: they check the route table's contract.

// openRoutes are the only endpoints reachable without a bearer token.
var openRoutes = map[string]bool{
	"GET /api/health":           true,
	"GET /api/v1/auth/config":   true,
	"POST /api/v1/auth/login":   true,
	"POST /api/v1/auth/refresh": true,
	"POST /api/v1/auth/google":  true,
	"POST /api/v1/telemetry":    true, // devices use X-Device-Key
}

func routerNoDB() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return NewRouter(nil, "", AuthOptions{JWTSecret: []byte("test")}, nil, nil)
}

func TestEveryProtectedRouteRequiresAuth(t *testing.T) {
	r := routerNoDB()
	for _, rt := range r.Routes() {
		if openRoutes[rt.Method+" "+rt.Path] {
			continue
		}
		path := strings.ReplaceAll(rt.Path, ":id", "x")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(rt.Method, path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", rt.Method, rt.Path, w.Code)
		}
	}
}

var kebab = regexp.MustCompile(`^/api/v1(/([a-z][a-z0-9-]*|:id))+$`)

func TestRoutePathsAreLowercaseKebab(t *testing.T) {
	for _, rt := range routerNoDB().Routes() {
		if rt.Path == "/api/health" {
			continue
		}
		if !kebab.MatchString(rt.Path) {
			t.Errorf("%s %s: path segments must be lowercase kebab-case (or :id)", rt.Method, rt.Path)
		}
	}
}

func TestMutationsUseNoGetAndNoDuplicateRoutes(t *testing.T) {
	seen := map[string]bool{}
	for _, rt := range routerNoDB().Routes() {
		key := rt.Method + " " + rt.Path
		if seen[key] {
			t.Errorf("duplicate route %s", key)
		}
		seen[key] = true
		// reads must not hide an action verb in the path
		if rt.Method == http.MethodGet && regexp.MustCompile(`/(set|create|update|delete|toggle)\b`).MatchString(rt.Path) {
			t.Errorf("GET %s looks like an action", rt.Path)
		}
	}
}

func TestUnknownPathAnswersJSON404(t *testing.T) {
	r := routerNoDB()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil))
	if w.Code != http.StatusNotFound || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("got %d %q", w.Code, w.Body.String())
	}
}

func TestWrongMethodAnswersJSON405(t *testing.T) {
	r := routerNoDB()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/api/health", nil))
	if w.Code != http.StatusMethodNotAllowed || !strings.Contains(w.Body.String(), `"error"`) {
		t.Fatalf("got %d %q", w.Code, w.Body.String())
	}
}

func TestRateLimiterBlocksAfterMaxThenResets(t *testing.T) {
	now := time.Unix(1000, 0)
	l := newRateLimiter(2, time.Minute)
	l.now = func() time.Time { return now }
	if !l.allow("a") || !l.allow("a") || l.allow("a") {
		t.Fatal("want 2 allowed then blocked")
	}
	if !l.allow("b") {
		t.Error("other clients are unaffected")
	}
	now = now.Add(61 * time.Second)
	if !l.allow("a") {
		t.Error("window should reset")
	}
}

func TestLoginIsRateLimited(t *testing.T) {
	r := routerNoDB() // login fails before touching the DB when the body is empty
	var last int
	for i := 0; i < 12; i++ {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil))
		last = w.Code
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("12th login attempt = %d, want 429", last)
	}
}

func TestSearchEscapesLikeWildcards(t *testing.T) {
	if got := likeEscaper.Replace(`50%_a\b`); got != `50\%\_a\\b` {
		t.Errorf("escaped = %q", got)
	}
}

func TestValidClock(t *testing.T) {
	for s, want := range map[string]bool{"06:30": true, "23:59": true, "00:00": true, "6:30": false, "24:00": false, "12:60": false, "": false, "ab:cd": false} {
		if got := validClock(s); got != want {
			t.Errorf("validClock(%q) = %v, want %v", s, got, want)
		}
	}
}
