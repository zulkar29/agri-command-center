package db

import (
	"math"
	"time"

	"github.com/farm-command/backend/internal/models"
)

const farmSlug = "my-farm"

// The demo logins every client shows as a hint on its login screen — one
// per role so permission differences are easy to try.
const (
	DemoEmail    = "owner@farm.com"
	DemoPassword = "farm123"

	DemoOperatorEmail = "baba@farm.com"
	DemoViewerEmail   = "guest@farm.com"
)

// seedModels returns the demo dataset in insert order. The Bengali strings
// mirror src/data/seed.ts so switching the dashboard from localStorage to the
// API keeps the same look and feel.
func seedModels() []any {
	now := time.Now()
	nowMs := now.UnixMilli()
	const H = int64(3_600_000)
	const D = int64(24 * H)

	farm := &models.Farm{
		ID:          "farm1",
		Slug:        farmSlug,
		Name:        "আমার সবজি বাগান",
		Simulate:    true,
		Mode:        "auto",
		PumpOn:      false,
		Threshold:   35,
		PumpFlowLpm: 25,
		Duration:    20,
		Moist:       []float64{44, 38, 31},
		Valves:      []bool{true, true, true},
		Tank:        68,
		Humidity:    78,
		Temp:        28,
		Volt:        12.6,
		Notif:       models.NotifSettings{Push: true, Sms: true, Whatsapp: false, Telegram: false},
	}

	rules := []*models.Rule{
		{ID: "r1", FarmID: "farm1", Text: "কাল বৃষ্টির সম্ভাবনা ৬০% এর বেশি হলে সেচ বাদ দাও", On: true, Kind: models.RuleRainSkip},
		{ID: "r2", FarmID: "farm1", Text: "ট্যাংক ২০% এর নিচে নামলে পাম্প বন্ধ করো", On: true, Kind: models.RuleTankGuard},
		{ID: "r3", FarmID: "farm1", Text: "সন্ধ্যা ৬টা থেকে ভোর ৫টা পর্যন্ত পাম্প চালিও না", On: false},
		{ID: "r4", FarmID: "farm1", Text: "সেন্সর ৩০ মিনিট সাড়া না দিলে সতর্কতা পাঠাও", On: true},
	}

	schedules := []*models.Schedule{
		{FarmID: "farm1", Time: "07:00", Dur: 20, Zone: "সব জোন", On: true},
		{FarmID: "farm1", Time: "16:30", Dur: 15, Zone: "জোন গ", On: false},
	}

	logs := []*models.LogEntry{
		{FarmID: "farm1", At: nowMs - 2*H, Text: "অটো সেচ · সব জোন · ২০ মিনিট"},
		{FarmID: "farm1", At: nowMs - D - 2*H, Text: "অটো সেচ · সব জোন · ২০ মিনিট"},
		{FarmID: "farm1", At: nowMs - 3*D, Text: "হাতে সেচ · জোন গ · ১০ মিনিট"},
	}

	// zones link each field to the valve that waters it (litres-per-kg needs it)
	zoneA, zoneC := 0, 2
	fields := []*models.Field{
		{ID: "field-tomato", FarmID: "farm1", Name: "টমেটো বাগান", Crop: "টমেটো", Area: 25, Plants: 300, Age: 52, HarvestAt: 75, Zone: &zoneA},
		{ID: "field-brinjal", FarmID: "farm1", Name: "নমুনা: বেগুনের সারি", Crop: "বেগুন", Area: 5, Plants: 60, Age: 20, HarvestAt: 80, Zone: &zoneC},
	}

	scout := []*models.Observation{
		{FarmID: "farm1", At: nowMs - D, Kind: "ঠিক আছে", Note: "জোন ক-এ পাতা সবুজ, সমস্যা দেখিনি", FieldID: "field-tomato"},
		{FarmID: "farm1", At: nowMs - 3*D, Kind: "পোকা", Note: "জোন গ-এ কয়েকটা পাতায় ছিদ্র", FieldID: "field-tomato"},
		{FarmID: "farm1", At: nowMs - 10*D, Kind: "রোগ", Note: "নিচের পাতায় দাগ — ছত্রাক সন্দেহ, স্প্রে করা হলো", FieldID: "field-tomato"},
		{FarmID: "farm1", At: nowMs - 2*D, Kind: "ঠিক আছে", Note: "চারা সতেজ, নতুন পাতা আসছে", FieldID: "field-brinjal"},
	}

	tasks := []*models.Task{
		{FarmID: "farm1", Text: "সকালে ট্যাংক ও পাইপ দেখা", Who: "বাবা", Due: "আজ", Done: true},
		// a deadline that has just passed, so the overdue alert shows in the demo
		{FarmID: "farm1", Text: "জোন গ-এর গাছ বাঁধা", Who: "বাবা", Due: "আজ", DueAt: nowMs - H},
		{FarmID: "farm1", Text: "হলুদ ফাঁদ বদলানো", Who: "শ্রমিক", Due: "কাল", DueAt: nowMs + D},
		{FarmID: "farm1", Text: "পাকা টমেটো তোলা ও ক্রেটে ভরা", Who: "বাবা", Due: "এই সপ্তাহ", DueAt: nowMs + 3*D, Urgent: true},
		{FarmID: "farm1", Text: "টমেটোতে ছত্রাকনাশক স্প্রে", Who: "বাবা", Due: "এই সপ্তাহ", DueAt: nowMs + 2*D, RepeatDays: 10, FieldID: "field-tomato"},
		{FarmID: "farm1", Text: "বেগুনে সার ও মালচ দেখা", Who: "আমি", Due: "এই সপ্তাহ", DueAt: nowMs + 4*D, FieldID: "field-brinjal"},
	}

	// Two months of entries, both fields tagged, a few untagged — enough for the
	// profit-and-loss report to show categories, per-field profit and a cost lesson.
	const T, B = "field-tomato", "field-brinjal"
	ledger := []*models.LedgerEntry{
		{FarmID: "farm1", At: nowMs - 2*H, Type: "income", Cat: "ফসল বিক্রি", Amount: 4800, Note: "১২০ কেজি টমেটো", FieldID: T},
		{FarmID: "farm1", At: nowMs - D, Type: "expense", Cat: "সার", Amount: 3200, Note: "ইউরিয়া ও পটাশ", FieldID: T},
		{FarmID: "farm1", At: nowMs - 3*D, Type: "expense", Cat: "শ্রম", Amount: 2500, Note: "সাপ্তাহিক মজুরি"},
		{FarmID: "farm1", At: nowMs - 4*D, Type: "expense", Cat: "কীটনাশক", Amount: 1800, Note: "ছত্রাকনাশক ও ফাঁদ", FieldID: T},
		{FarmID: "farm1", At: nowMs - 7*D, Type: "income", Cat: "ফসল বিক্রি", Amount: 4500, Note: "৯০ কেজি টমেটো", FieldID: T},
		{FarmID: "farm1", At: nowMs - 10*D, Type: "expense", Cat: "সার", Amount: 600, Note: "বেগুনের জৈব সার", FieldID: B},
		{FarmID: "farm1", At: nowMs - 14*D, Type: "income", Cat: "ফসল বিক্রি", Amount: 5500, Note: "১০০ কেজি টমেটো", FieldID: T},
		{FarmID: "farm1", At: nowMs - 17*D, Type: "expense", Cat: "শ্রম", Amount: 2500, Note: "সাপ্তাহিক মজুরি"},
		{FarmID: "farm1", At: nowMs - 20*D, Type: "expense", Cat: "সরঞ্জাম", Amount: 1500, Note: "মালচ শিট ও ড্রিপ জোড়া", FieldID: B},
		{FarmID: "farm1", At: nowMs - 25*D, Type: "expense", Cat: "বীজ ও চারা", Amount: 900, Note: "বেগুনের চারা", FieldID: B},
		{FarmID: "farm1", At: nowMs - 31*D, Type: "expense", Cat: "শ্রম", Amount: 4000, Note: "টমেটো মাচা ও চারা রোপণ", FieldID: T},
		{FarmID: "farm1", At: nowMs - 38*D, Type: "expense", Cat: "সরঞ্জাম", Amount: 1200, Note: "বাঁশের খুঁটি ও দড়ি"},
		{FarmID: "farm1", At: nowMs - 52*D, Type: "expense", Cat: "বীজ ও চারা", Amount: 3500, Note: "টমেটোর চারা", FieldID: T},
	}

	// Harvest log behind the three tomato sales above (price per kg = sale ÷ kg).
	harvests := []*models.Harvest{
		{FarmID: "farm1", FieldID: T, At: nowMs - 14*D, Kg: 100, Grade: "ক", PricePerKg: 55, Note: "প্রথম তোলা"},
		{FarmID: "farm1", FieldID: T, At: nowMs - 7*D, Kg: 90, Grade: "ক", PricePerKg: 50, Note: "দ্বিতীয় তোলা"},
		{FarmID: "farm1", FieldID: T, At: nowMs - 2*H, Kg: 120, Grade: "খ", PricePerKg: 40, Note: "বাজারে দাম কমে গেছে"},
	}

	// The 07:00 watering of the last two weeks (20 min × the farm's 25 L/min),
	// so the water cards and litres-per-kg have a real account to show.
	var runs []*models.PumpRun
	for d := int64(1); d <= 14; d++ {
		start := nowMs - d*D - (nowMs % D) + 7*H // 07:00 UTC-aligned day slot, d days back
		runs = append(runs, &models.PumpRun{FarmID: "farm1", Start: start, End: start + 20*60_000, Zones: []int{0, 1, 2}, Litres: 500, Source: "schedule"})
	}

	stock := []*models.StockItem{
		{FarmID: "farm1", Name: "ইউরিয়া সার", Unit: "কেজি", Qty: 18, Min: 10},
		{FarmID: "farm1", Name: "পটাশ সার", Unit: "কেজি", Qty: 6, Min: 10},
		{FarmID: "farm1", Name: "জৈব সার", Unit: "কেজি", Qty: 120, Min: 50},
		{FarmID: "farm1", Name: "কীটনাশক", Unit: "লিটার", Qty: 1.5, Min: 1},
		{FarmID: "farm1", Name: "মালচ শিট", Unit: "রোল", Qty: 2, Min: 1},
		{FarmID: "farm1", Name: "বাঁশের খুঁটি", Unit: "পিস", Qty: 140, Min: 100},
	}

	prices := []*models.MarketPrice{
		{FarmID: "farm1", Crop: "টমেটো", At: nowMs - 14*D, PricePerKg: 55, Market: "স্থানীয় বাজার"},
		{FarmID: "farm1", Crop: "টমেটো", At: nowMs - D, PricePerKg: 40, Market: "স্থানীয় বাজার"},
		{FarmID: "farm1", Crop: "পালং শাক", At: nowMs - 2*D, PricePerKg: 35, Market: "স্থানীয় বাজার"},
		{FarmID: "farm1", Crop: "মুলা", At: nowMs - 2*D, PricePerKg: 25, Market: "স্থানীয় বাজার"},
		{FarmID: "farm1", Crop: "ফুলকপি", At: nowMs - 3*D, PricePerKg: 45, Market: "স্থানীয় বাজার"},
	}

	team := []*models.TeamMember{
		{FarmID: "farm1", Name: "আপনি", Role: "মালিক"},
		{FarmID: "farm1", Name: "বাবা", Role: "অপারেটর"},
	}

	devices := []*models.Device{
		{ID: "esp32-gw-1", FarmID: "farm1", Kind: "gateway", Online: true, ApiKey: "dev-key-gw-1",
			Metrics: map[string]float64{"rssi": -61, "uptime_h": 312}, LastSeenAt: nowMs - 60_000},
		{ID: "esp32-field-1", FarmID: "farm1", Kind: "sensor", Online: true, ApiKey: "dev-key-sensor-1",
			Metrics: map[string]float64{"battery_v": 12.6, "signal": 82}, LastSeenAt: nowMs - 60_000},
		{ID: "pump-relay-1", FarmID: "farm1", Kind: "relay", Online: true,
			Metrics: map[string]float64{"state": 0, "current_a": 0}, LastSeenAt: nowMs - 60_000},
	}

	out := []any{farm}
	for _, group := range [][]any{
		ptrSlice(rules), ptrSlice(schedules), ptrSlice(logs),
		ptrSlice(fields), ptrSlice(scout), ptrSlice(tasks), ptrSlice(ledger),
		ptrSlice(stock), ptrSlice(harvests), ptrSlice(runs), ptrSlice(prices), ptrSlice(team), ptrSlice(devices),
	} {
		out = append(out, group...)
	}
	return out
}

// telemetryHistory is 7 days of readings at 30-minute intervals with a diurnal
// pattern (air temp/humidity follow day-night, moisture dries out and jumps
// when the morning schedule runs), so the analytics charts have real rows.
var telemetryHistory = buildHistory()

func buildHistory() []models.Telemetry {
	const interval = 30 * time.Minute
	const days = 7
	now := time.Now().Add(-time.Hour) // last reading ~1h ago

	rows := make([]models.Telemetry, 0, days*48)
	moist := []float64{44, 38, 31}
	tank := 80.0

	for t := now.Add(-time.Duration(days*24) * time.Hour); !t.After(now); t = t.Add(interval) {
		hour := float64(t.Hour()) + float64(t.Minute())/60

		// sunrise ~6:00, peak heat ~14:00
		temp := 24 + 6*math.Sin((hour-6)/24*2*math.Pi)
		humidity := 85 - 20*math.Sin((hour-6)/24*2*math.Pi)

		// morning irrigation at 07:00 lifts moisture and drains the tank
		if t.Hour() == 7 && t.Minute() == 0 {
			for i := range moist {
				moist[i] = math.Min(75, moist[i]+12)
			}
			tank = math.Max(0, tank-8)
		}
		if hour >= 8 && hour <= 17 {
			for i := range moist {
				moist[i] = math.Max(12, moist[i]-0.35)
			}
			tank = math.Max(0, tank-0.05)
		} else {
			for i := range moist {
				moist[i] = math.Min(60, moist[i]+0.08)
			}
		}
		if tank < 15 { // refill
			tank = 85
		}

		rows = append(rows, models.Telemetry{
			FarmSlug:     farmSlug,
			Node:         "esp32-field-1",
			Ts:           t,
			SoilMoisture: []float64{round1(moist[0]), round1(moist[1]), round1(moist[2])},
			AirTemp:      round1(temp),
			AirHumidity:  round1(humidity),
			TankLevel:    round1(tank),
			BatteryV:     round2(12.2 + 0.3*math.Sin(hour/24*2*math.Pi)),
		})
	}
	return rows
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }

func ptrSlice[T any](in []*T) []any {
	out := make([]any, len(in))
	for i, v := range in {
		out[i] = v
	}
	return out
}
