package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/live"
)

// maxStreams caps open streams per server; a farm has a handful of viewers,
// so hitting it means something is reconnecting in a loop.
const maxStreams = 500

// streamHeartbeat keeps proxies and NATs from closing an idle stream.
const streamHeartbeat = 25 * time.Second

// stream (GET /api/v1/stream) is a Server-Sent Events feed of the farm's live
// changes, so the dashboard needs no tight polling:
//
//	event: farm       data: the control snapshot (GET /farm's body)
//	event: telemetry  data: one stored reading (POST /telemetry's body)
//	event: alerts     data: {} — the alert list changed, refetch it
//	event: devices    data: {} — the device list changed, refetch it
//
// The first event is always a farm snapshot. There is no replay
// (Last-Event-ID): after any reconnect the client starts from that snapshot
// and refetches its lists. The stream ends when the access token expires
// (one last `event: expired`), so a role change or logout takes effect
// within accessTTL; the client refreshes its token and reconnects.
//
// Auth is the usual bearer header — read it with fetch, not EventSource,
// which cannot send headers (a token in the URL would land in access logs).
func (a *API) stream(c *gin.Context) {
	if a.Live == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "এই সার্ভারে লাইভ আপডেট চালু নেই।"})
		return
	}
	if a.Live.Count() >= maxStreams {
		c.Header("Retry-After", "30")
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "লাইভ সংযোগ অনেক বেশি — একটু পরে আবার চেষ্টা করুন।"})
		return
	}
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	state, err := a.loadState(farm.ID)
	if err != nil {
		serverError(c, err)
		return
	}
	snapshot, err := json.Marshal(state)
	if err != nil {
		serverError(c, err)
		return
	}

	sub := a.Live.Subscribe(farm.ID)
	defer a.Live.Unsubscribe(sub)

	expiry := time.NewTimer(time.Until(c.GetTime("tokenExp")))
	defer expiry.Stop()
	heartbeat := time.NewTicker(streamHeartbeat)
	defer heartbeat.Stop()

	h := c.Writer.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // nginx and similar: do not hold events back
	c.Status(http.StatusOK)

	w := c.Writer
	fmt.Fprint(w, "retry: 3000\n\n")
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", live.EventFarm, snapshot)
	w.Flush()

	for {
		select {
		case <-c.Request.Context().Done():
			return
		case <-expiry.C:
			fmt.Fprint(w, "event: expired\ndata: {}\n\n")
			w.Flush()
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": ping\n\n")
		case ev, open := <-sub.C:
			if !open { // too slow: dropped by the hub; the client resyncs
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Name, ev.Data)
		}
		w.Flush()
	}
}

// publishWrites runs after every successful operator/owner write and tells
// open streams which views it changed. Handlers stay unaware of the stream;
// currentFarm leaves the farm id on the context.
func (a *API) publishWrites(c *gin.Context) {
	c.Next()
	if a.Live == nil || c.Request.Method == http.MethodGet || c.Writer.Status() >= 400 {
		return
	}
	farmID := c.GetString("farmID")
	if farmID == "" {
		return
	}
	if events := writeEvents(strings.TrimPrefix(c.FullPath(), APIBase)); len(events) > 0 {
		a.Live.Touch(farmID, events...)
	}
}

// writeEvents maps a write route to the stream events it invalidates. Lists
// outside the stream (tasks, ledger, stock…) keep their own polling.
func writeEvents(route string) []string {
	switch {
	case route == "/farm/pump":
		// the pump switch also rewrites the relay row (pump.SyncRelay)
		return []string{live.EventFarm, live.EventDevices}
	case strings.HasPrefix(route, "/farm"), strings.HasPrefix(route, "/rules"):
		return []string{live.EventFarm}
	case strings.HasPrefix(route, "/alerts"):
		return []string{live.EventAlerts}
	case strings.HasPrefix(route, "/devices"):
		// a relay command switches the pump too
		return []string{live.EventDevices, live.EventFarm}
	}
	return nil
}
