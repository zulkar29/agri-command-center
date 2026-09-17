package sensors

import (
	"testing"
	"time"
)

var t0 = time.Date(2026, 1, 1, 6, 0, 0, 0, time.UTC)

func series(n int, step time.Duration, f func(i int) []float64) []Reading {
	out := make([]Reading, n)
	for i := range out {
		out[i] = Reading{Ts: t0.Add(time.Duration(i) * step), SoilMoisture: f(i)}
	}
	return out
}

func TestHealthySeriesHasNoFaults(t *testing.T) {
	rs := series(30, 10*time.Minute, func(i int) []float64 { return []float64{40 + float64(i%5), 50 - float64(i%3)} })
	if f := Analyze(rs); len(f) != 0 {
		t.Fatalf("faults = %v", f)
	}
}

func TestStuckZone(t *testing.T) {
	rs := series(20, 10*time.Minute, func(i int) []float64 { return []float64{42.0, 40 + float64(i%4)} })
	f := Analyze(rs)
	if len(f) != 1 || f[0].Zone != 0 {
		t.Fatalf("faults = %v", f)
	}
}

func TestStuckNeedsSpan(t *testing.T) {
	// 12 identical readings but only 1 minute apart → not enough time
	rs := series(15, time.Minute, func(i int) []float64 { return []float64{42} })
	if f := Analyze(rs); len(f) != 0 {
		t.Fatalf("faults = %v", f)
	}
}

func TestJump(t *testing.T) {
	rs := series(5, 5*time.Minute, func(i int) []float64 {
		if i >= 3 {
			return []float64{95}
		}
		return []float64{30}
	})
	f := Analyze(rs)
	if len(f) != 1 {
		t.Fatalf("faults = %v", f)
	}
}

func TestJumpAcrossLongGapIgnored(t *testing.T) {
	rs := []Reading{
		{Ts: t0, SoilMoisture: []float64{20}},
		{Ts: t0.Add(3 * time.Hour), SoilMoisture: []float64{70}},
	}
	if f := Analyze(rs); len(f) != 0 {
		t.Fatalf("faults = %v", f)
	}
}

func TestImpossibleValue(t *testing.T) {
	rs := []Reading{{Ts: t0, SoilMoisture: []float64{120}}}
	if f := Analyze(rs); len(f) != 1 {
		t.Fatalf("faults = %v", f)
	}
}

func TestFaultyMask(t *testing.T) {
	m := FaultyMask([]Fault{{Zone: 1}, {Zone: 9}}, 3)
	if m[0] || !m[1] || m[2] {
		t.Fatalf("mask = %v", m)
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(30, 60, 50, 12.5); err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][4]float64{{100, 50, 50, 12}, {30, 101, 50, 12}, {30, 50, -1, 12}, {30, 50, 50, 99}} {
		if Validate(bad[0], bad[1], bad[2], bad[3]) == nil {
			t.Fatalf("accepted %v", bad)
		}
	}
}
