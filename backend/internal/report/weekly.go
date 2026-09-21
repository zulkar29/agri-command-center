// Package report builds the farm's weekly summary: water used, money in and
// out, harvest, and what still needs doing. The same numbers back
// GET /api/v1/reports/weekly-summary and the Friday-morning message sent over
// Telegram/SMS (internal/notify), so the app and the phone never disagree.
package report

import (
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/bangla"
	"github.com/farm-command/backend/internal/models"
)

// Weekly is the last seven days at a glance.
type Weekly struct {
	From          int64    `json:"from"` // epoch ms
	To            int64    `json:"to"`
	Litres        float64  `json:"litres"`
	PumpRuns      int      `json:"pumpRuns"`
	Income        float64  `json:"income"`
	Expense       float64  `json:"expense"`
	HarvestKg     float64  `json:"harvestKg"`
	OpenTasks     int      `json:"openTasks"`
	OverdueTasks  int      `json:"overdueTasks"`
	LowStock      []string `json:"lowStock"`
	ActiveAlerts  int      `json:"activeAlerts"`
	PumpFlowKnown bool     `json:"pumpFlowKnown"` // false → litres are 0 because the flow was never set
}

// Build sums the seven days ending at now.
func Build(db *gorm.DB, farm *models.Farm, now time.Time) (Weekly, error) {
	to := now.UnixMilli()
	w := Weekly{From: now.AddDate(0, 0, -7).UnixMilli(), To: to, LowStock: []string{}, PumpFlowKnown: farm.PumpFlowLpm > 0}

	scalar := func(dst any, query string, args ...any) error {
		return db.Raw(query, args...).Scan(dst).Error
	}
	steps := []func() error{
		func() error {
			return scalar(&w.Litres, `SELECT COALESCE(SUM(litres),0) FROM pump_runs WHERE farm_id = ? AND start >= ?`, farm.ID, w.From)
		},
		func() error {
			var n int64
			err := scalar(&n, `SELECT COUNT(*) FROM pump_runs WHERE farm_id = ? AND start >= ?`, farm.ID, w.From)
			w.PumpRuns = int(n)
			return err
		},
		func() error {
			return scalar(&w.Income, `SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE farm_id = ? AND type = 'income' AND at >= ?`, farm.ID, w.From)
		},
		func() error {
			return scalar(&w.Expense, `SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE farm_id = ? AND type = 'expense' AND at >= ?`, farm.ID, w.From)
		},
		func() error {
			return scalar(&w.HarvestKg, `SELECT COALESCE(SUM(kg),0) FROM harvests WHERE farm_id = ? AND at >= ?`, farm.ID, w.From)
		},
		func() error {
			var n int64
			err := db.Model(&models.Task{}).Where("farm_id = ? AND done = ?", farm.ID, false).Count(&n).Error
			w.OpenTasks = int(n)
			return err
		},
		func() error {
			var n int64
			err := db.Model(&models.Task{}).Where("farm_id = ? AND done = ? AND due_at > 0 AND due_at < ?", farm.ID, false, to).Count(&n).Error
			w.OverdueTasks = int(n)
			return err
		},
		func() error {
			var n int64
			err := db.Model(&models.Alert{}).Where("farm_id = ? AND active = ?", farm.ID, true).Count(&n).Error
			w.ActiveAlerts = int(n)
			return err
		},
		func() error {
			var stock []models.StockItem
			if err := db.Where("farm_id = ? AND min > 0 AND qty <= min", farm.ID).Order("name").Find(&stock).Error; err != nil {
				return err
			}
			for _, s := range stock {
				w.LowStock = append(w.LowStock, s.Name)
			}
			return nil
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return Weekly{}, err
		}
	}
	return w, nil
}

// Text is the message a phone receives.
func (w Weekly) Text(farmName string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "📋 %s · সাপ্তাহিক সারসংক্ষেপ\n", farmName)
	if w.PumpFlowKnown {
		fmt.Fprintf(&b, "💧 পানি: %s লিটার (%s বার পাম্প চলেছে)\n", bangla.Num(int(w.Litres+0.5)), bangla.Num(w.PumpRuns))
	} else {
		fmt.Fprintf(&b, "💧 পাম্প চলেছে %s বার (পাম্পের প্রবাহ দেওয়া নেই, তাই লিটার জানা নেই)\n", bangla.Num(w.PumpRuns))
	}
	// math.Round, not int(x+0.5): a loss (negative profit) must round too
	fmt.Fprintf(&b, "💰 আয় ৳%s · খরচ ৳%s · লাভ ৳%s\n",
		bangla.Num(int64(math.Round(w.Income))), bangla.Num(int64(math.Round(w.Expense))), bangla.Num(int64(math.Round(w.Income-w.Expense))))
	if w.HarvestKg > 0 {
		fmt.Fprintf(&b, "🌾 ফসল তোলা: %s কেজি\n", bangla.Num(int(w.HarvestKg+0.5)))
	}
	fmt.Fprintf(&b, "✅ বাকি কাজ: %s টি", bangla.Num(w.OpenTasks))
	if w.OverdueTasks > 0 {
		fmt.Fprintf(&b, " (সময় পার: %s টি)", bangla.Num(w.OverdueTasks))
	}
	b.WriteString("\n")
	if len(w.LowStock) > 0 {
		fmt.Fprintf(&b, "🛒 কিনতে হবে: %s\n", strings.Join(w.LowStock, ", "))
	}
	if w.ActiveAlerts > 0 {
		fmt.Fprintf(&b, "⚠️ চালু সতর্কতা: %s টি\n", bangla.Num(w.ActiveAlerts))
	}
	return strings.TrimRight(b.String(), "\n")
}

// digestWeekday and digestHour: Friday 08:00 farm time, the rest day.
const (
	digestWeekday = time.Friday
	digestHour    = 8
)

// Due reports whether the weekly message should go out now: it is Friday
// morning (or later that day) on the farm's clock and none went out in the
// last six days. Pure, so the schedule is testable.
func Due(now time.Time, last *time.Time) bool {
	local := now.In(models.FarmZone)
	if local.Weekday() != digestWeekday || local.Hour() < digestHour {
		return false
	}
	return last == nil || now.Sub(*last) > 6*24*time.Hour
}

// MaybeSend builds and sends the weekly summary when it is due, remembering
// the time so it goes out once. send delivers the text (notify.Router.Text).
func MaybeSend(db *gorm.DB, farm *models.Farm, now time.Time, send func(*models.Farm, string)) {
	if send == nil || !Due(now, farm.DigestAt) {
		return
	}
	w, err := Build(db, farm, now)
	if err != nil {
		log.Printf("report: weekly summary for %s: %v", farm.ID, err)
		return
	}
	// mark first: a failed send is not retried every tick all morning
	if err := db.Model(&models.Farm{}).Where("id = ?", farm.ID).Update("digest_at", now).Error; err != nil {
		log.Printf("report: marking digest for %s: %v", farm.ID, err)
		return
	}
	farm.DigestAt = &now
	send(farm, w.Text(farm.Name))
}
