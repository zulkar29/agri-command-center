package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/report"
	"github.com/farm-command/backend/internal/water"
)

// Water account and field efficiency. Reports are read-only
// views computed from pump runs and harvests; see internal/water.

// queryDays reads ?days= (default def, 1..365).
func queryDays(c *gin.Context, def int) (int, bool) {
	v := c.Query("days")
	if v == "" {
		return def, true
	}
	d, err := strconv.Atoi(v)
	if err != nil || d < 1 || d > 365 {
		badRequest(c, errInvalid("days", "1..365"))
		return 0, false
	}
	return d, true
}

// GET /api/v1/pump-runs?page=&limit=&days= — pump runs, newest first.
func (a *API) listPumpRuns(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	days, ok := queryDays(c, 30)
	if !ok {
		return
	}
	since := time.Now().AddDate(0, 0, -days).UnixMilli()
	var rows []models.PumpRun
	respondPaged(c, a.DB.Where("farm_id = ? AND start >= ?", farm.ID, since), p, "start desc", &rows)
}

type dayLitres struct {
	Day    string  `json:"day"`
	Litres float64 `json:"litres"`
}

// waterUseReport: GET /api/v1/reports/water-use?days=30 — total litres, per zone and per farm day.
func (a *API) waterUseReport(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	days, ok := queryDays(c, 30)
	if !ok {
		return
	}
	var runs []models.PumpRun
	since := time.Now().AddDate(0, 0, -days).UnixMilli()
	if err := a.DB.Where("farm_id = ? AND start >= ?", farm.ID, since).Order("start").Find(&runs).Error; err != nil {
		serverError(c, err)
		return
	}
	total := 0.0
	perDayIdx := map[string]int{}
	perDay := []dayLitres{}
	for _, r := range runs {
		total += r.Litres
		day := time.UnixMilli(r.Start).In(models.FarmZone).Format("2006-01-02")
		i, seen := perDayIdx[day]
		if !seen {
			i = len(perDay)
			perDayIdx[day] = i
			perDay = append(perDay, dayLitres{Day: day})
		}
		perDay[i].Litres += r.Litres
	}
	c.JSON(http.StatusOK, gin.H{
		"days": days, "runs": len(runs), "litres": total,
		"perZone": water.ZoneLitres(runs, len(farm.Moist)), "perDay": perDay,
		"pumpFlowLpm": farm.PumpFlowLpm,
	})
}

// GET /api/v1/reports/field-efficiency?days=365 — litres per kg for every field.
func (a *API) fieldEfficiencyReport(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	days, ok := queryDays(c, 365)
	if !ok {
		return
	}
	since := time.Now().AddDate(0, 0, -days).UnixMilli()
	var fields []models.Field
	var runs []models.PumpRun
	var harvests []models.Harvest
	for _, step := range []func() error{
		func() error { return a.DB.Where("farm_id = ?", farm.ID).Order("created_at").Find(&fields).Error },
		func() error { return a.DB.Where("farm_id = ? AND start >= ?", farm.ID, since).Find(&runs).Error },
		func() error { return a.DB.Where("farm_id = ? AND at >= ?", farm.ID, since).Find(&harvests).Error },
	} {
		if err := step(); err != nil {
			serverError(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"days": days, "items": water.Efficiency(fields, runs, harvests, len(farm.Moist)),
	})
}

// GET /api/v1/reports/weekly-summary — the last seven days at a glance
// (internal/report), the same numbers the Friday message carries.
func (a *API) weeklySummary(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	w, err := report.Build(a.DB, farm, time.Now())
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}
