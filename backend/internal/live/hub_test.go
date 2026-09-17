package live

import (
	"sync/atomic"
	"testing"
	"time"
)

func recv(t *testing.T, s *Sub) Event {
	t.Helper()
	select {
	case ev, ok := <-s.C:
		if !ok {
			t.Fatal("stream closed")
		}
		return ev
	case <-time.After(2 * time.Second):
		t.Fatal("no event")
	}
	return Event{}
}

func TestTouchCoalescesIntoOneSnapshotRead(t *testing.T) {
	h := New()
	h.Window = 20 * time.Millisecond
	var loads atomic.Int32
	h.Snapshot = func(string) (any, error) {
		loads.Add(1)
		return map[string]int{"tank": 50}, nil
	}

	a, b := h.Subscribe("f1"), h.Subscribe("f1")
	for range 10 {
		h.Touch("f1", EventFarm, EventAlerts)
	}
	for _, s := range []*Sub{a, b} {
		if ev := recv(t, s); ev.Name != EventFarm || string(ev.Data) != `{"tank":50}` {
			t.Fatalf("first event = %s %s", ev.Name, ev.Data)
		}
		if ev := recv(t, s); ev.Name != EventAlerts || string(ev.Data) != "{}" {
			t.Fatalf("second event = %s %s", ev.Name, ev.Data)
		}
	}
	if n := loads.Load(); n != 1 {
		t.Fatalf("snapshot loaded %d times, want 1 for 10 touches and 2 viewers", n)
	}
}

func TestUnwatchedFarmCostsNothing(t *testing.T) {
	h := New()
	h.Window = time.Millisecond
	h.Snapshot = func(string) (any, error) { t.Fatal("snapshot loaded with no subscriber"); return nil, nil }
	h.Touch("f1", EventFarm)
	h.Publish("f1", EventTelemetry, map[string]int{"x": 1})
	time.Sleep(20 * time.Millisecond)

	var nilHub *Hub
	nilHub.Touch("f1", EventFarm) // the engine and API run without a hub in tests
	nilHub.Publish("f1", EventFarm, nil)
}

func TestSlowSubscriberIsDroppedNotWaitedOn(t *testing.T) {
	h := New()
	slow, fast := h.Subscribe("f1"), h.Subscribe("f1")

	done := make(chan struct{})
	go func() {
		for range subBuffer + 5 {
			h.Publish("f1", EventTelemetry, nil)
			<-fast.C
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("publisher blocked on a slow subscriber")
	}

	n := 0
	for range slow.C {
		n++
	}
	if n != subBuffer {
		t.Fatalf("slow subscriber got %d buffered events before the drop, want %d", n, subBuffer)
	}
	if h.Count() != 1 {
		t.Fatalf("open streams = %d, want 1", h.Count())
	}
	h.Unsubscribe(slow) // already dropped: must not panic
	h.Unsubscribe(fast)
	if h.Count() != 0 {
		t.Fatalf("open streams = %d after unsubscribe", h.Count())
	}
}
