package report

import (
	"strings"
	"testing"
	"time"

	"github.com/farm-command/backend/internal/models"
)

// 2026-10-09 is a Friday.
func dhaka(day, hour int) time.Time {
	return time.Date(2026, 10, day, hour, 0, 0, 0, models.FarmZone).UTC()
}

func TestDueOnlyFridayMorningOncePerWeek(t *testing.T) {
	lastWeek := dhaka(2, 8)
	cases := []struct {
		name string
		now  time.Time
		last *time.Time
		want bool
	}{
		{"friday 09:00, never sent", dhaka(9, 9), nil, true},
		{"friday 07:00 is too early", dhaka(9, 7), nil, false},
		{"thursday", dhaka(8, 12), nil, false},
		{"friday, sent last friday", dhaka(9, 9), &lastWeek, true},
		{"friday, already sent today", dhaka(9, 10), ptr(dhaka(9, 8)), false},
		{"saturday", dhaka(10, 9), nil, false},
	}
	for _, c := range cases {
		if got := Due(c.now, c.last); got != c.want {
			t.Errorf("%s: Due = %v want %v", c.name, got, c.want)
		}
	}
	// the weekday is the farm's, not the host's: Friday 01:00 Dhaka is still Thursday in UTC
	if Due(dhaka(9, 1), nil) {
		t.Error("01:00 is before the send hour")
	}
}

func ptr(t time.Time) *time.Time { return &t }

func TestTextMentionsWhatMatters(t *testing.T) {
	w := Weekly{
		Litres: 1200, PumpRuns: 5, Income: 5000, Expense: 1800, HarvestKg: 40,
		OpenTasks: 4, OverdueTasks: 1, LowStock: []string{"পটাশ সার", "ছত্রাকনাশক"}, ActiveAlerts: 2, PumpFlowKnown: true,
	}
	got := w.Text("আমার বাগান")
	for _, want := range []string{"আমার বাগান", "১২০০ লিটার", "লাভ ৳৩২০০", "সময় পার: ১", "পটাশ সার, ছত্রাকনাশক", "৪০ কেজি"} {
		if !strings.Contains(got, want) {
			t.Errorf("summary should contain %q:\n%s", want, got)
		}
	}
	w.PumpFlowKnown = false
	if !strings.Contains(w.Text("x"), "প্রবাহ দেওয়া নেই") {
		t.Error("unknown flow should say litres are unknown rather than print 0")
	}
}

func TestTextRoundsALoss(t *testing.T) {
	got := Weekly{Income: 0, Expense: 10.7}.Text("ফার্ম")
	if !strings.Contains(got, "লাভ ৳-১১") {
		t.Errorf("a 10.7 loss should read -১১:\n%s", got)
	}
}
