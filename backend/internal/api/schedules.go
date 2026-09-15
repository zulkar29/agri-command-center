package api

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// --- schedules ------------------------------------------------------------
//
// GET /api/v1/schedules?page=&limit=&zone=&on= — zone is an exact match.

type createScheduleReq struct {
	Time string `json:"time" binding:"required"`
	Dur  int    `json:"dur" binding:"min=1,max=240"`
	Zone string `json:"zone" binding:"required"`
}

func (a *API) listSchedules(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if zone := c.Query("zone"); zone != "" {
		q = q.Where("zone = ?", zone)
	}
	if on, ok := queryBool(c, "on"); !ok {
		return
	} else if on != nil {
		q = q.Where("\"on\" = ?", *on)
	}
	var schedules []models.Schedule
	respondPaged(c, q, p, "created_at", &schedules)
}

func (a *API) createSchedule(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createScheduleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if !validClock(req.Time) {
		badRequest(c, errInvalid("time", "HH:MM (24-hour)"))
		return
	}
	if !validScheduleZone(req.Zone) {
		badRequest(c, errInvalid("zone", scheduleZoneWant()))
		return
	}
	schedule := models.Schedule{FarmID: farm.ID, Time: req.Time, Dur: req.Dur, Zone: req.Zone, On: true}
	if err := a.DB.Create(&schedule).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "schedule.create", schedule.Time+" · "+schedule.Zone)
	c.JSON(http.StatusCreated, schedule)
}

type patchScheduleReq struct {
	On   *bool   `json:"on"`
	Time *string `json:"time"`
	Dur  *int    `json:"dur"`
	Zone *string `json:"zone"`
}

func (a *API) patchSchedule(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchScheduleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if req.Time != nil && !validClock(*req.Time) {
		badRequest(c, errInvalid("time", "HH:MM (24-hour)"))
		return
	}
	if req.Dur != nil && (*req.Dur < 1 || *req.Dur > 240) {
		badRequest(c, errInvalid("dur", "1..240 minutes"))
		return
	}
	if req.Zone != nil && !validScheduleZone(*req.Zone) {
		badRequest(c, errInvalid("zone", scheduleZoneWant()))
		return
	}
	var schedule models.Schedule
	if !a.findInFarm(c, farm.ID, &schedule) {
		return
	}
	if req.On != nil {
		schedule.On = *req.On
	}
	if req.Time != nil {
		schedule.Time = *req.Time
	}
	if req.Dur != nil {
		schedule.Dur = *req.Dur
	}
	if req.Zone != nil {
		schedule.Zone = *req.Zone
	}
	// not Save: last_run is the engine's, written when a schedule fires —
	// putting back the value loaded above could make it fire twice
	if err := a.DB.Model(&schedule).Select("on", "time", "dur", "zone").Updates(&schedule).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "schedule.update", schedule.Time+" → "+map[bool]string{true: "চালু", false: "বন্ধ"}[schedule.On])
	c.JSON(http.StatusOK, schedule)
}

func (a *API) deleteSchedule(c *gin.Context) { deleteInFarm[models.Schedule](a, c, "schedule.delete") }

// allZones is the schedule zone that waters every open zone.
const allZones = "সব জোন"

// validScheduleZone reports whether the engine can act on a schedule's zone
// (engine.scheduleZones): one of models.ZoneNames or allZones. Anything else
// would be stored and then silently water nothing.
func validScheduleZone(zone string) bool {
	return zone == allZones || slices.Contains(models.ZoneNames, zone)
}

func scheduleZoneWant() string {
	return "one of " + allZones + " | " + strings.Join(models.ZoneNames, " | ")
}

// validClock reports whether s is a 24-hour "HH:MM" time — the only form the
// engine's schedule matcher (engine.Step) ever fires on.
func validClock(s string) bool {
	_, err := time.Parse("15:04", s)
	return err == nil && len(s) == 5
}
