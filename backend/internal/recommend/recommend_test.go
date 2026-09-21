package recommend

import (
	"strings"
	"testing"
)

func find(t *testing.T, got []Suggestion, id string) Suggestion {
	t.Helper()
	for _, s := range got {
		if s.CropID == id {
			return s
		}
	}
	t.Fatalf("crop %q missing from ranking", id)
	return Suggestion{}
}

func reasonScore(t *testing.T, s Suggestion, factor string) float64 {
	t.Helper()
	for _, r := range s.Reasons {
		if r.Factor == factor {
			return r.Score
		}
	}
	t.Fatalf("no %s reason in %+v", factor, s)
	return -1
}

func TestRotationPenalisesSameFamilyAndCrop(t *testing.T) {
	got := Rank(Input{Month: 11, CurrentCrop: "টমেটো", TankPct: 80})
	same, family, other := reasonScore(t, find(t, got, "tomato"), "rotation"),
		reasonScore(t, find(t, got, "brinjal"), "rotation"), reasonScore(t, find(t, got, "spinach"), "rotation")
	if !(other > family && family > same) {
		t.Fatalf("rotation: other family %v > same family %v > same crop %v", other, family, same)
	}
	// spinach is in season and a different family — it should beat repeating tomato
	if find(t, got, "spinach").Score <= find(t, got, "tomato").Score {
		t.Fatalf("a fresh in-season family should outrank repeating the crop: %+v", got[:3])
	}
}

func TestProblemNotesMakeSameFamilyWorse(t *testing.T) {
	clean := find(t, Rank(Input{Month: 11, CurrentCrop: "টমেটো", TankPct: 80}), "brinjal")
	sick := find(t, Rank(Input{Month: 11, CurrentCrop: "টমেটো", ProblemNotes: 3, TankPct: 80}), "brinjal")
	if sick.Score >= clean.Score {
		t.Fatalf("recent disease notes should lower a same-family crop: %d vs %d", sick.Score, clean.Score)
	}
	var found bool
	for _, r := range sick.Reasons {
		if r.Factor == "rotation" && strings.Contains(r.Text, "৩") {
			found = true
		}
	}
	if !found {
		t.Fatalf("the reason should name the problem count: %+v", sick.Reasons)
	}
}

func TestSeasonDecidesAndAdjacentMonthIsHalf(t *testing.T) {
	// tomato sows Oct-Dec: Nov in season, Sep adjacent, Jun out
	for month, want := range map[int]float64{11: 1, 9: 0.5, 6: 0} {
		var got float64
		for _, r := range find(t, Rank(Input{Month: month}), "tomato").Reasons {
			if r.Factor == "season" {
				got = r.Score
			}
		}
		if got != want {
			t.Fatalf("month %d season score = %v want %v", month, got, want)
		}
	}
}

func TestDryMonthWithLowTankHurtsThirstyCrops(t *testing.T) {
	score := func(month int, tank float64) float64 {
		for _, r := range find(t, Rank(Input{Month: month, TankPct: tank}), "cucumber").Reasons {
			if r.Factor == "water" {
				return r.Score
			}
		}
		return -1
	}
	if wet, dryFull, dryLow := score(7, 20), score(3, 80), score(3, 20); !(wet > dryFull && dryFull > dryLow) {
		t.Fatalf("water fit: wet season %v > dry+full tank %v > dry+low tank %v", wet, dryFull, dryLow)
	}
}

func TestMarketUsesLatestPriceAndTrend(t *testing.T) {
	prices := []Price{
		{Crop: "পালং শাক", PricePerKg: 20, At: 1}, {Crop: "পালং শাক", PricePerKg: 40, At: 3},
		{Crop: "মুলা", PricePerKg: 20, At: 2},
	}
	got := Rank(Input{Month: 11, Prices: prices})
	marketOf := func(id string) Reason {
		for _, r := range find(t, got, id).Reasons {
			if r.Factor == "market" {
				return r
			}
		}
		t.Fatal("no market reason")
		return Reason{}
	}
	if sp, mu, none := marketOf("spinach"), marketOf("radish"), marketOf("tomato"); !(sp.Score > mu.Score) || none.Score != 0.5 {
		t.Fatalf("spinach %+v, radish %+v, no price %+v", sp, mu, none)
	}
	if !strings.Contains(marketOf("spinach").Text, "৪০") || !strings.Contains(marketOf("spinach").Text, "বেশি") {
		t.Fatalf("text should show the latest price and the trend: %q", marketOf("spinach").Text)
	}
}

func TestRankIsStableAndBounded(t *testing.T) {
	in := Input{Month: 3, CurrentCrop: "কিছু অজানা", TankPct: 10}
	a, b := Rank(in), Rank(in)
	for i := range a {
		if a[i].CropID != b[i].CropID || a[i].Score < 0 || a[i].Score > 100 || len(a[i].Reasons) != 4 {
			t.Fatalf("unstable or out of range at %d: %+v vs %+v", i, a[i], b[i])
		}
		if i > 0 && a[i].Score > a[i-1].Score {
			t.Fatal("not sorted best first")
		}
	}
	custom := Rank(Input{Month: 11, Weights: Weights{Season: 1}}) // season only
	if custom[0].Score != 100 {
		t.Fatalf("season-only weights should give in-season crops 100: %d", custom[0].Score)
	}
}
