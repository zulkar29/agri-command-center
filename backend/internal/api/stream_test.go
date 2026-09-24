package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/farm-command/backend/internal/live"
)

// sseReader reads one SSE stream event by event (comments are skipped).
type sseReader struct {
	t    *testing.T
	scan *bufio.Scanner
}

func openStream(t *testing.T, base, token string) *sseReader {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+"/api/v1/stream", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	t.Cleanup(func() { res.Body.Close() })
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("stream = %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	return &sseReader{t: t, scan: bufio.NewScanner(res.Body)}
}

// next returns the next event's name and data, failing after 3 s.
func (s *sseReader) next() (string, map[string]any) {
	s.t.Helper()
	type ev struct {
		name, data string
		ok         bool
	}
	got := make(chan ev, 1)
	go func() {
		var name, data string
		for s.scan.Scan() {
			line := s.scan.Text()
			switch {
			case line == "" && name != "":
				got <- ev{name, data, true}
				return
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
		}
		got <- ev{}
	}()
	select {
	case e := <-got:
		if !e.ok {
			s.t.Fatal("stream ended")
		}
		var body map[string]any
		if err := json.Unmarshal([]byte(e.data), &body); err != nil {
			s.t.Fatalf("event %s: data is not JSON: %q", e.name, e.data)
		}
		return e.name, body
	case <-time.After(3 * time.Second):
		s.t.Fatal("no event within 3s")
	}
	return "", nil
}

func liveServer(t *testing.T) (*httptest.Server, *live.Hub) {
	t.Helper()
	r, db := testDB(t) // seeds the farm and logs in
	hub := live.New()
	hub.Window = 10 * time.Millisecond
	r = NewRouter(db, "", AuthOptions{JWTSecret: []byte("test-secret-not-for-prod")}, nil, hub)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, hub
}

func post(t *testing.T, method, url, token string, body any) int {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, url, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	res.Body.Close()
	return res.StatusCode
}

func TestStreamPushesSnapshotWritesAndTelemetry(t *testing.T) {
	srv, hub := liveServer(t)
	s := openStream(t, srv.URL, testToken)

	if name, body := s.next(); name != live.EventFarm || body["slug"] != "test-farm" {
		t.Fatalf("first event = %s %v, want the farm snapshot", name, body)
	}

	if code := post(t, http.MethodPut, srv.URL+"/api/v1/farm/pump", testToken, map[string]string{"state": "on"}); code != http.StatusOK {
		t.Fatalf("pump on = %d", code)
	}
	if name, body := s.next(); name != live.EventFarm || body["pumpOn"] != true {
		t.Fatalf("after pump on = %s %v, want a snapshot with the pump on", name, body)
	}
	if name, _ := s.next(); name != live.EventDevices {
		t.Fatalf("after pump on = %s, want devices (the relay row changed)", name)
	}

	reading := map[string]any{"farm": "test-farm", "node": "esp32-x", "soil_moisture": []float64{30, 31, 32}, "air_temp": 29.5}
	if code := post(t, http.MethodPost, srv.URL+"/api/v1/telemetry", "", reading); code != http.StatusCreated {
		t.Fatalf("telemetry = %d", code)
	}
	if name, body := s.next(); name != live.EventTelemetry || body["air_temp"] != 29.5 {
		t.Fatalf("after telemetry = %s %v, want the reading", name, body)
	}
	if name, _ := s.next(); name != live.EventFarm {
		t.Fatalf("after telemetry = %s, want the refreshed snapshot", name)
	}

	// a rejected write tells nobody anything
	if code := post(t, http.MethodPut, srv.URL+"/api/v1/farm/pump", testToken, map[string]string{"state": "maybe"}); code != http.StatusBadRequest {
		t.Fatalf("bad pump state = %d", code)
	}
	if code := post(t, http.MethodPatch, srv.URL+"/api/v1/alerts/none", testToken, map[string]bool{"ack": true}); code < 400 {
		t.Fatalf("ack of a missing alert = %d", code)
	}
	if hub.Count() != 1 {
		t.Fatalf("open streams = %d, want 1", hub.Count())
	}
}

func TestStreamEndsWhenTheAccessTokenExpires(t *testing.T) {
	srv, hub := liveServer(t)
	claims := accessClaims{Name: "আপনি", Email: testEmail, Role: "মালিক", RegisteredClaims: jwt.RegisteredClaims{
		Subject: "u", ExpiresAt: jwt.NewNumericDate(time.Now().Add(1500 * time.Millisecond)),
	}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret-not-for-prod"))
	if err != nil {
		t.Fatal(err)
	}

	s := openStream(t, srv.URL, token)
	if name, _ := s.next(); name != live.EventFarm {
		t.Fatalf("first event = %s", name)
	}
	if name, _ := s.next(); name != "expired" {
		t.Fatalf("event at expiry = %s, want expired", name)
	}
	deadline := time.Now().Add(time.Second)
	for hub.Count() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if hub.Count() != 0 {
		t.Fatal("expired stream still subscribed")
	}
}

func TestStreamWithoutHubIs503(t *testing.T) {
	r, _ := testDB(t)
	if code, _ := request(t, r, http.MethodGet, "/api/v1/stream", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("stream without hub = %d, want 503", code)
	}
}
