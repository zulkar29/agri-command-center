// Package live fans farm changes out to open dashboard streams
// (GET /api/v1/stream, Server-Sent Events). It is in-process: one backend
// instance holds every subscriber. Running several instances would need the
// same interface backed by PostgreSQL LISTEN/NOTIFY.
//
// Cost model — what keeps a stream cheaper than polling:
//   - Nothing is read or encoded while a farm has no subscriber.
//   - Touch coalesces: a burst of changes within Window becomes one event,
//     and the "farm" snapshot is loaded once and sent to every subscriber.
//   - A subscriber whose buffer is full is dropped rather than waited on, so
//     a slow phone never stalls the engine or a telemetry post; its client
//     reconnects and resyncs from a fresh snapshot.
package live

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// Event names the clients switch on.
const (
	// EventFarm carries the full control snapshot (GET /api/v1/farm's body).
	EventFarm = "farm"
	// EventTelemetry carries one stored reading (POST /api/v1/telemetry's body).
	EventTelemetry = "telemetry"
	// EventAlerts and EventDevices carry no data: the list changed, refetch it.
	EventAlerts  = "alerts"
	EventDevices = "devices"
)

// DefaultWindow is how long Touch gathers changes before sending them.
const DefaultWindow = time.Second

// subBuffer is how many events a subscriber may fall behind before it is dropped.
const subBuffer = 32

// Event is one encoded SSE message.
type Event struct {
	Name string
	Data []byte
}

// Sub is one open stream. C closes when the hub drops it (too slow) or it
// unsubscribes.
type Sub struct {
	C      <-chan Event
	c      chan Event
	farmID string
	closed bool
}

type Hub struct {
	// Snapshot loads the farm snapshot for EventFarm; set by api.NewRouter.
	// Nil → farm touches are not sent.
	Snapshot func(farmID string) (any, error)
	// Window is the coalescing delay for Touch (0 → DefaultWindow).
	Window time.Duration

	mu    sync.Mutex
	subs  map[string]map[*Sub]struct{}
	dirty map[string]map[string]bool // farm → touched events awaiting flush
}

func New() *Hub {
	return &Hub{subs: map[string]map[*Sub]struct{}{}, dirty: map[string]map[string]bool{}}
}

// Subscribe opens a stream on the farm's events; call Unsubscribe when done.
func (h *Hub) Subscribe(farmID string) *Sub {
	c := make(chan Event, subBuffer)
	s := &Sub{C: c, c: c, farmID: farmID}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[farmID] == nil {
		h.subs[farmID] = map[*Sub]struct{}{}
	}
	h.subs[farmID][s] = struct{}{}
	return s
}

// Unsubscribe closes the stream; safe to call after the hub dropped it.
func (h *Hub) Unsubscribe(s *Sub) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.dropLocked(s)
}

func (h *Hub) dropLocked(s *Sub) {
	if s.closed {
		return
	}
	s.closed = true
	close(s.c)
	delete(h.subs[s.farmID], s)
	if len(h.subs[s.farmID]) == 0 {
		delete(h.subs, s.farmID)
	}
}

// Count reports the open streams across all farms.
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, m := range h.subs {
		n += len(m)
	}
	return n
}

func (h *Hub) watched(farmID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs[farmID]) > 0
}

// Publish sends an event right away (encoded once for every subscriber).
// data nil sends {}. A nil hub or an unwatched farm is a no-op.
func (h *Hub) Publish(farmID, name string, data any) {
	if h == nil || !h.watched(farmID) {
		return
	}
	b := []byte("{}")
	if data != nil {
		var err error
		if b, err = json.Marshal(data); err != nil {
			log.Printf("live: encoding %s: %v", name, err)
			return
		}
	}
	h.send(farmID, Event{Name: name, Data: b})
}

func (h *Hub) send(farmID string, ev Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.subs[farmID] {
		select {
		case s.c <- ev:
		default: // full: drop it, the client reconnects and resyncs
			h.dropLocked(s)
		}
	}
}

// Touch marks events as changed for the farm; within Window they are sent
// once — EventFarm with a freshly loaded snapshot, the others as bare
// "refetch" signals. A nil hub or an unwatched farm is a no-op.
func (h *Hub) Touch(farmID string, names ...string) {
	if h == nil || len(names) == 0 || !h.watched(farmID) {
		return
	}
	h.mu.Lock()
	pending := h.dirty[farmID]
	first := pending == nil
	if first {
		pending = map[string]bool{}
		h.dirty[farmID] = pending
	}
	for _, n := range names {
		pending[n] = true
	}
	h.mu.Unlock()

	if first {
		w := h.Window
		if w <= 0 {
			w = DefaultWindow
		}
		time.AfterFunc(w, func() { h.flush(farmID) })
	}
}

func (h *Hub) flush(farmID string) {
	h.mu.Lock()
	pending := h.dirty[farmID]
	delete(h.dirty, farmID)
	h.mu.Unlock()

	// farm first: a client that refetches alerts after it sees the fresh snapshot
	if pending[EventFarm] && h.Snapshot != nil && h.watched(farmID) {
		if s, err := h.Snapshot(farmID); err != nil {
			log.Printf("live: loading snapshot for %s: %v", farmID, err)
		} else {
			h.Publish(farmID, EventFarm, s)
		}
	}
	for _, n := range []string{EventAlerts, EventDevices} {
		if pending[n] {
			h.Publish(farmID, n, nil)
		}
	}
}
