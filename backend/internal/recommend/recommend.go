// Package recommend ranks which crop a field could take next. It is a plain
// weighted score, not machine learning: a farm grows two or three crops a
// year, so there is nothing to learn from, but there is plenty to reason with.
// Every factor says why it scored as it did, and the app shows the strongest
// reasons next to the number — the farmer decides, the app shows the evidence.
//
// Rank is pure (no clock, no database), like the engine's Step, so it is
// tested by feeding it inputs.
package recommend

import (
	"fmt"
	"sort"

	"github.com/farm-command/backend/internal/bangla"
	"github.com/farm-command/backend/internal/crops"
)

// Weights say how much each factor counts; they need not sum to anything.
type Weights struct {
	Season   float64 `json:"season"`
	Rotation float64 `json:"rotation"`
	Water    float64 `json:"water"`
	Market   float64 `json:"market"`
}

// DefaultWeights favour sowing at the right time and not repeating a family,
// the two things that decide most seasons.
var DefaultWeights = Weights{Season: 35, Rotation: 30, Water: 15, Market: 20}

// Price is one entry of the owner's price book.
type Price struct {
	Crop       string
	PricePerKg float64
	At         int64
}

// Input is everything the ranking looks at.
type Input struct {
	Month int // 1-12, the month the next crop would go in
	// CurrentCrop is what the field grows now (a Field.Crop name, may be unknown).
	CurrentCrop string
	// ProblemNotes counts recent pest/disease observations on the field.
	ProblemNotes int
	// TankPct is the farm's water level; low in a dry month makes thirsty crops risky.
	TankPct float64
	Prices  []Price
	Weights Weights
}

// Reason is one factor's verdict: Score 0..1 and the sentence behind it.
type Reason struct {
	Factor string  `json:"factor"` // season | rotation | water | market
	Score  float64 `json:"score"`
	Text   string  `json:"text"`
}

// Suggestion is one candidate crop with its 0..100 score and reasons.
type Suggestion struct {
	CropID  string   `json:"cropId"`
	Crop    string   `json:"crop"`
	Score   int      `json:"score"`
	Reasons []Reason `json:"reasons"` // strongest contribution first
}

// Rank scores every template and returns them best first (ties by name, so
// the order is stable).
func Rank(in Input) []Suggestion {
	w := in.Weights
	if w == (Weights{}) {
		w = DefaultWeights
	}
	current, known := crops.ByName(in.CurrentCrop)
	latest, avg := priceStats(in.Prices)
	maxLatest := 0.0
	for _, p := range latest {
		if p > maxLatest {
			maxLatest = p
		}
	}

	var out []Suggestion
	for _, c := range crops.All() {
		reasons := []Reason{
			season(c, in.Month),
			rotation(c, current, known, in.CurrentCrop, in.ProblemNotes),
			waterFit(c, in.Month, in.TankPct),
			market(c, latest, avg, maxLatest),
		}
		weights := []float64{w.Season, w.Rotation, w.Water, w.Market}
		var sum, total float64
		for i, r := range reasons {
			sum += r.Score * weights[i]
			total += weights[i]
		}
		score := 0
		if total > 0 {
			score = int(sum/total*100 + 0.5)
		}
		// strongest contributors first, so the top reasons are the ones that mattered
		idx := []int{0, 1, 2, 3}
		sort.SliceStable(idx, func(a, b int) bool {
			return reasons[idx[a]].Score*weights[idx[a]] > reasons[idx[b]].Score*weights[idx[b]]
		})
		ordered := make([]Reason, len(reasons))
		for i, k := range idx {
			ordered[i] = reasons[k]
		}
		out = append(out, Suggestion{CropID: c.ID, Crop: c.Name, Score: score, Reasons: ordered})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Crop < out[j].Crop
	})
	return out
}

func season(c crops.Template, month int) Reason {
	r := Reason{Factor: "season"}
	switch {
	case hasMonth(c.SowMonths, month):
		r.Score, r.Text = 1, "এখন বপনের সময়"
	case hasMonth(c.SowMonths, month%12+1) || hasMonth(c.SowMonths, (month+10)%12+1):
		r.Score, r.Text = 0.5, "বপনের সময়ের কাছাকাছি (আগের বা পরের মাস)"
	default:
		r.Score, r.Text = 0, "এখন বপনের সময় নয়"
	}
	return r
}

func rotation(c, current crops.Template, known bool, currentName string, problems int) Reason {
	r := Reason{Factor: "rotation"}
	switch {
	case currentName == "" || !known:
		r.Score, r.Text = 0.5, "মাঠে এখন কী ফসল তা চেনা যায়নি — পালাক্রম ধরা হয়নি"
	case c.ID == current.ID:
		r.Score, r.Text = 0, "একই ফসল আবার — রোগ-পোকা থেকে যায়"
	case c.Family == current.Family:
		r.Score = 0.1
		r.Text = "একই পরিবারের ফসল (" + current.Name + " এর পর) — রোগ-পোকার ঝুঁকি"
		if problems > 0 {
			r.Score = 0
			r.Text += fmt.Sprintf("; মাঠে সম্প্রতি %s বার সমস্যা ধরা পড়েছে", bangla.Num(problems))
		}
	default:
		r.Score, r.Text = 1, current.Name+" এর পর ভিন্ন পরিবারের ফসল — পালাক্রম ভালো"
	}
	return r
}

// dry months in Bangladesh: Dec-Apr, when water is the limit
func isDry(month int) bool { return month == 12 || month <= 4 }

func waterFit(c crops.Template, month int, tankPct float64) Reason {
	r := Reason{Factor: "water"}
	switch {
	case !isDry(month):
		r.Score, r.Text = 1, "এখন পানির টান নেই"
	case c.WaterNeed >= 3:
		r.Score, r.Text = 0.3, "শুকনো মৌসুমে বেশি পানির ফসল — ঝুঁকি"
		if tankPct < 50 {
			r.Score, r.Text = 0.1, "শুকনো মৌসুম, ট্যাংকেও পানি কম — বেশি পানির ফসল ঝুঁকিপূর্ণ"
		}
	case c.WaterNeed == 2:
		r.Score, r.Text = 0.7, "শুকনো মৌসুমে মাঝারি পানি লাগে"
	default:
		r.Score, r.Text = 1, "শুকনো মৌসুমে কম পানির ফসল — সুবিধা"
	}
	return r
}

// priceStats returns each crop's newest price and its average over the book.
func priceStats(prices []Price) (latest, avg map[string]float64) {
	latest, avg = map[string]float64{}, map[string]float64{}
	newest := map[string]int64{}
	sum, n := map[string]float64{}, map[string]int{}
	for _, p := range prices {
		if p.PricePerKg <= 0 {
			continue
		}
		if p.At >= newest[p.Crop] {
			newest[p.Crop], latest[p.Crop] = p.At, p.PricePerKg
		}
		sum[p.Crop] += p.PricePerKg
		n[p.Crop]++
	}
	for crop, s := range sum {
		avg[crop] = s / float64(n[crop])
	}
	return latest, avg
}

func market(c crops.Template, latest, avg map[string]float64, maxLatest float64) Reason {
	r := Reason{Factor: "market"}
	p, ok := latest[c.Name]
	if !ok || maxLatest <= 0 {
		r.Score, r.Text = 0.5, "দামের তথ্য নেই (বাজারদরের খাতায় লিখে রাখুন)"
		return r
	}
	// how it stands among the crops we have prices for, nudged by its own trend
	r.Score = p / maxLatest
	r.Text = fmt.Sprintf("সর্বশেষ দাম ৳%s/কেজি", bangla.Num(int(p+0.5)))
	switch a := avg[c.Name]; {
	case a > 0 && p >= a*1.1:
		r.Text += " — গড়ের চেয়ে বেশি"
		r.Score = min1(r.Score + 0.1)
	case a > 0 && p <= a*0.9:
		r.Text += " — গড়ের চেয়ে কম"
		r.Score = max0(r.Score - 0.1)
	}
	return r
}

func hasMonth(months []int, m int) bool {
	for _, x := range months {
		if x == m {
			return true
		}
	}
	return false
}

func min1(v float64) float64 {
	if v > 1 {
		return 1
	}
	return v
}

func max0(v float64) float64 {
	if v < 0 {
		return 0
	}
	return v
}
