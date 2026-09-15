package api

import (
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/bangla"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/pump"
	"github.com/farm-command/backend/internal/water"
)

// farmState is the control snapshot the dashboard/mobile hydrate their store
// from: the farm row itself (whose JSON tags match src/types.ts — moist and
// valves are per-zone arrays on the row) plus the three collections that have
// no REST resource of their own. Everything else (tasks, fields, ledger,
// stock, schedules, observations) is listed from its own endpoint with
// ?q=&page=&limit= filters, so each fact has exactly one API home.
type farmState struct {
	models.Farm
	Rules  []models.Rule       `json:"rules"`
	IrrLog []models.LogEntry   `json:"irrLog"`
	Team   []models.TeamMember `json:"team"`
}

func (a *API) loadState(farmID string) (*farmState, error) {
	var farm models.Farm
	if err := a.DB.First(&farm, "id = ?", farmID).Error; err != nil {
		return nil, err
	}

	// nil maps/slices marshal as null; the clients expect {} and []
	if farm.Moist == nil {
		farm.Moist = []float64{}
	}
	if farm.Valves == nil {
		farm.Valves = []bool{}
	}

	s := &farmState{Farm: farm}
	s.Rules = []models.Rule{}
	s.IrrLog = []models.LogEntry{}
	s.Team = []models.TeamMember{}

	if err := a.DB.Where("farm_id = ?", farmID).Order("created_at").Find(&s.Rules).Error; err != nil {
		return nil, err
	}
	if err := a.DB.Where("farm_id = ?", farmID).Order("at desc").Limit(20).Find(&s.IrrLog).Error; err != nil {
		return nil, err
	}
	if err := a.DB.Where("farm_id = ?", farmID).Order("created_at").Find(&s.Team).Error; err != nil {
		return nil, err
	}
	return s, nil
}

func (a *API) getFarm(c *gin.Context) { a.sendFarm(c, http.StatusOK) }

// sendFarm answers with the control snapshot under the given status — 200 for
// reads and state changes, 201 for the POSTs that create a watering/tank fill.
func (a *API) sendFarm(c *gin.Context, status int) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	s, err := a.loadState(farm.ID)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(status, s)
}

type patchFarmReq struct {
	FarmName  *string `json:"farmName"`
	Simulate  *bool   `json:"simulate"`
	Mode      *string `json:"mode"` // 'auto' | 'manual'
	Threshold *int    `json:"threshold"`
	Duration  *int    `json:"duration"`
	// Valves replaces the per-zone valve states wholesale (the array is tiny
	// and the UI always has the full current state, so a whole-array PUT of
	// the valves is simpler than per-zone sub-resources).
	Valves *[]bool               `json:"valves"`
	Notif  *models.NotifSettings `json:"notif"`
	// Location for the weather service; owner-only like the name above.
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
	// PumpFlowLpm is the measured pump flow (litres/min), owner-only.
	PumpFlowLpm *float64 `json:"pumpFlowLpm"`
	// MaxDailyMinutes caps auto-mode pump minutes per day (0 = no limit), owner-only.
	MaxDailyMinutes *int `json:"maxDailyMinutes"`
}

func (a *API) patchFarm(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchFarmReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}

	// farm identity/setup fields are owner-only; the irrigation fields
	// (mode/threshold/duration/valves) are operator work
	if user := currentUser(c); user.Role != models.RoleOwner &&
		(req.FarmName != nil || req.Simulate != nil || req.Notif != nil || req.Lat != nil || req.Lng != nil || req.PumpFlowLpm != nil || req.MaxDailyMinutes != nil) {
		forbidden(c, "ফার্মের নাম, নোটিফিকেশন, অবস্থান বা পাম্পের সীমা বদলাতে মালিক হতে হবে।")
		return
	}

	// only the columns this request carries are written: the engine and the
	// telemetry ingest update the same row concurrently (pump, moisture,
	// tank), and a whole-row Save would put back what they just changed
	var cols []string

	if req.FarmName != nil {
		if strings.TrimSpace(*req.FarmName) == "" || len(*req.FarmName) > 100 {
			badRequest(c, errInvalid("farmName", "not empty"))
			return
		}
		farm.Name = *req.FarmName
		cols = append(cols, "name")
	}
	if req.Simulate != nil {
		farm.Simulate = *req.Simulate
		cols = append(cols, "simulate")
	}
	if req.Mode != nil {
		if *req.Mode != "auto" && *req.Mode != "manual" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "মোড auto বা manual হতে হবে।"})
			return
		}
		farm.Mode = *req.Mode
		cols = append(cols, "mode")
	}
	if (req.Threshold != nil && (*req.Threshold < 0 || *req.Threshold > 100)) ||
		(req.Duration != nil && (*req.Duration < 1 || *req.Duration > 240)) {
		badRequest(c, errInvalid("threshold/duration", "threshold 0..100, duration 1..240"))
		return
	}
	if req.Threshold != nil {
		farm.Threshold = *req.Threshold
		cols = append(cols, "threshold")
	}
	if req.Duration != nil {
		farm.Duration = *req.Duration
		cols = append(cols, "duration")
	}
	if req.Valves != nil {
		if len(*req.Valves) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "অন্তত একটা জোন থাকতে হবে।"})
			return
		}
		if len(*req.Valves) > 32 {
			badRequest(c, errInvalid("valves", "at most 32 zones"))
			return
		}
		farm.Valves = *req.Valves
		cols = append(cols, "valves")
	}
	if req.Notif != nil {
		farm.Notif = *req.Notif
		cols = append(cols, "notif")
	}
	if (req.Lat != nil && (*req.Lat < -90 || *req.Lat > 90)) || (req.Lng != nil && (*req.Lng < -180 || *req.Lng > 180)) {
		badRequest(c, errInvalid("lat/lng", "lat -90..90, lng -180..180"))
		return
	}
	if req.Lat != nil {
		farm.Lat = req.Lat
		cols = append(cols, "lat")
	}
	if req.Lng != nil {
		farm.Lng = req.Lng
		cols = append(cols, "lng")
	}
	if req.PumpFlowLpm != nil {
		if *req.PumpFlowLpm < 0 || *req.PumpFlowLpm > 100000 {
			badRequest(c, errInvalid("pumpFlowLpm", "0..100000"))
			return
		}
		farm.PumpFlowLpm = *req.PumpFlowLpm
		cols = append(cols, "pump_flow_lpm")
	}
	if req.MaxDailyMinutes != nil {
		if *req.MaxDailyMinutes < 0 || *req.MaxDailyMinutes > 1440 {
			badRequest(c, errInvalid("maxDailyMinutes", "0..1440"))
			return
		}
		farm.MaxDailyMinutes = *req.MaxDailyMinutes
		cols = append(cols, "max_daily_minutes")
	}
	if len(cols) == 0 {
		a.getFarm(c) // nothing to change
		return
	}
	if err := a.DB.Model(farm).Select(cols).Updates(farm).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "farm.update", "ফার্মের সেটিংস বদলানো হয়েছে")
	a.getFarm(c)
}

// pushLog records an irrigation log line (newest first on read).
func (a *API) pushLog(farmID, text string) error {
	return a.DB.Create(&models.LogEntry{FarmID: farmID, At: time.Now().UnixMilli(), Text: text}).Error
}

type setPumpReq struct {
	State string `json:"state" binding:"required,oneof=on off"`
}

// setPump (PUT /api/v1/farm/pump) sets the pump state; like the dashboard,
// going manual happens implicitly. The state change itself lives in
// pump.SetManual, shared with the device-command endpoint.
func (a *API) setPump(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req setPumpReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	on := req.State == "on"
	text, err := pump.SetManual(a.DB, farm, on, time.Now())
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, map[bool]string{true: "pump.on", false: "pump.off"}[on], text)
	a.getFarm(c)
}

type waterZonesReq struct {
	Zones   []int `json:"zones" binding:"required,min=1,dive,min=0"`
	Minutes *int  `json:"minutes" binding:"omitempty,min=1,max=240"`
}

// waterZones waters the given zone indexes for the configured duration,
// mirroring the dashboard's manual watering action. Zones are indexes into
// the farm's moist/valves arrays; a closed valve skips its zone.
func (a *API) waterZones(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req waterZonesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}

	zoneCount := min(len(farm.Moist), len(farm.Valves))
	var openNames []string
	var zoneIdxs []int
	for _, idx := range req.Zones {
		if idx < 0 || idx >= zoneCount || !farm.Valves[idx] {
			continue
		}
		if farm.Moist[idx] < 75 {
			farm.Moist[idx] += 10
		}
		openNames = append(openNames, models.ZoneLabel(idx))
		zoneIdxs = append(zoneIdxs, idx)
	}
	if len(openNames) == 0 {
		unprocessable(c, "ভালভ বন্ধ থাকায় সেচ হয়নি। ভালভ চালু করুন।")
		return
	}

	label := strings.Join(openNames, ", ")
	minutes := farm.Duration
	if req.Minutes != nil {
		minutes = *req.Minutes
	}
	farm.Tank = math.Max(0, farm.Tank-2*float64(len(openNames)))
	// only the columns this action changes (see patchFarm)
	if err := a.DB.Model(farm).Select("moist", "tank").Updates(farm).Error; err != nil {
		serverError(c, err)
		return
	}
	if err := a.pushLog(farm.ID, "হাতে সেচ · "+label+" · "+bangla.Num(minutes)+" মিনিট"); err != nil {
		serverError(c, err)
		return
	}
	water.Burst(a.DB, farm, zoneIdxs, minutes, "manual", time.Now())
	a.audit(c, farm.ID, "water.manual", label+" · "+bangla.Num(minutes)+" মিনিট")
	a.sendFarm(c, http.StatusCreated)
}

// fillTank tops the tank up by 20%, like the dashboard button.
func (a *API) fillTank(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	tank := farm.Tank + 20
	if tank > 100 {
		tank = 100
	}
	if err := a.DB.Model(farm).Update("tank", tank).Error; err != nil {
		serverError(c, err)
		return
	}
	if err := a.pushLog(farm.ID, "ট্যাংক ভরা হয়েছে"); err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "tank.fill", "ট্যাংক ভরা হয়েছে")
	a.sendFarm(c, http.StatusCreated)
}

type patchRuleReq struct {
	On *bool `json:"on" binding:"required"`
}

// patchRule sets a rule on or off (an explicit state keeps PATCH idempotent:
// repeating a request never flips the rule back) and answers with the fresh control
// snapshot, so the store-side clients hydrate directly — no extra refetch.
func (a *API) patchRule(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchRuleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	var rule models.Rule
	if !a.findInFarm(c, farm.ID, &rule) {
		return
	}
	rule.On = *req.On
	if err := a.DB.Model(&rule).Update("on", rule.On).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "rule.toggle", rule.ID+" → "+map[bool]string{true: "চালু", false: "বন্ধ"}[rule.On])
	a.getFarm(c)
}
