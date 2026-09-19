package notify

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/farm-command/backend/internal/models"
)

type capture struct {
	mu   sync.Mutex
	hits []map[string]string
	auth string
}

func (c *capture) handler(status int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var m map[string]string
		_ = json.Unmarshal(b, &m)
		c.mu.Lock()
		c.hits, c.auth = append(c.hits, m), r.Header.Get("Authorization")
		c.mu.Unlock()
		w.WriteHeader(status)
	}
}

func TestSMSSendsJSONWithBearer(t *testing.T) {
	var got capture
	srv := httptest.NewServer(got.handler(200))
	defer srv.Close()

	if err := (SMS{URL: srv.URL, Token: "tok"}).Send("+8801700000000", "পানি কম"); err != nil {
		t.Fatal(err)
	}
	if len(got.hits) != 1 || got.hits[0]["to"] != "+8801700000000" || got.hits[0]["text"] != "পানি কম" || got.auth != "Bearer tok" {
		t.Fatalf("gateway got %v auth=%q", got.hits, got.auth)
	}
}

func TestSMSReportsGatewayFailure(t *testing.T) {
	var got capture
	srv := httptest.NewServer(got.handler(500))
	defer srv.Close()
	if err := (SMS{URL: srv.URL}).Send("+8801700000000", "x"); err == nil {
		t.Fatal("a 5xx from the gateway must surface as an error")
	}
}

// recipients is driven by the farm's channel switches; DB-less here, so the
// shared chat is the only Telegram recipient.
func TestRecipientsFollowFarmSwitches(t *testing.T) {
	r := &Router{Telegram: &Telegram{}, SMS: &SMS{}, FarmChat: "-100"}

	chats, phones := r.recipients(&models.Farm{Notif: models.NotifSettings{Telegram: true, Sms: true}})
	if len(chats) != 1 || chats[0] != "-100" || len(phones) != 0 {
		t.Fatalf("chats=%v phones=%v", chats, phones)
	}
	chats, _ = r.recipients(&models.Farm{})
	if len(chats) != 0 {
		t.Fatalf("with telegram switched off nothing is sent: %v", chats)
	}
	if (&Router{}).Enabled() || !r.Enabled() {
		t.Fatal("Enabled should reflect configured channels")
	}
}

// A transport error must not echo the URL — Telegram's holds the bot token.
func TestSendErrorHidesTheURL(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens any more: the request fails in transport
	err := postJSON(url+"/botSECRET-TOKEN/sendMessage", "", map[string]string{})
	if err == nil || strings.Contains(err.Error(), "SECRET-TOKEN") {
		t.Errorf("err = %v, want a transport error without the token", err)
	}
}
