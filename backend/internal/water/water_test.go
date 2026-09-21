package water

import (
	"math"
	"testing"

	"github.com/farm-command/backend/internal/models"
)

func TestLitres(t *testing.T) {
	if got := Litres(0, 10*60_000, 30); got != 300 {
		t.Fatalf("got %v", got)
	}
	if Litres(5, 5, 30) != 0 || Litres(0, 60_000, 0) != 0 || Litres(10, 5, 30) != 0 {
		t.Fatal("degenerate runs must be zero")
	}
}

func TestZoneLitresSplitsEqually(t *testing.T) {
	runs := []models.PumpRun{
		{Zones: []int{0, 1}, Litres: 100},
		{Zones: []int{1}, Litres: 40},
		{Zones: []int{7}, Litres: 999}, // outside range: dropped
		{Zones: nil, Litres: 5},
	}
	got := ZoneLitres(runs, 3)
	want := []float64{50, 90, 0}
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-9 {
			t.Fatalf("zone litres = %v want %v", got, want)
		}
	}
}

func TestOpenZones(t *testing.T) {
	got := OpenZones([]bool{true, false, true})
	if len(got) != 2 || got[0] != 0 || got[1] != 2 {
		t.Fatalf("got %v", got)
	}
}

func TestEfficiency(t *testing.T) {
	z0, z1 := 0, 1
	fields := []models.Field{
		{ID: "a", Name: "A", Zone: &z0},
		{ID: "b", Name: "B", Zone: &z0}, // shares zone 0 with A
		{ID: "c", Name: "C", Zone: &z1},
		{ID: "d", Name: "D"}, // unlinked
	}
	runs := []models.PumpRun{{Zones: []int{0, 1}, Litres: 400}}
	harvests := []models.Harvest{
		{FieldID: "a", Kg: 10, PricePerKg: 50},
		{FieldID: "a", Kg: 10, PricePerKg: 60},
		{FieldID: "d", Kg: 5},
	}
	got := Efficiency(fields, runs, harvests, 2)
	if got[0].Litres != 100 || got[0].Kg != 20 || got[0].Revenue != 1100 {
		t.Fatalf("a = %+v", got[0])
	}
	if got[0].LitresPerKg == nil || *got[0].LitresPerKg != 5 {
		t.Fatalf("a l/kg = %v", got[0].LitresPerKg)
	}
	if got[1].LitresPerKg != nil { // no harvest
		t.Fatalf("b l/kg should be nil")
	}
	if got[2].Litres != 200 {
		t.Fatalf("c = %+v", got[2])
	}
	if got[3].Litres != 0 || got[3].LitresPerKg != nil {
		t.Fatalf("d = %+v", got[3])
	}
}
