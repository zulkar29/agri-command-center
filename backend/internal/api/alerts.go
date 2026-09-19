package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// Server-side alerts (internal/alerts, evaluated by the engine): the same
// conditions the clients derived locally, persisted with activation state so
// they notify once and survive restarts.

// GET /api/v1/alerts?page=&limit=&active= — newest first in the Paged
// envelope; active=true lists only currently-holding alerts, active=false
// only cleared ones.
func (a *API) listAlerts(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if active, ok := queryBool(c, "active"); !ok {
		return
	} else if active != nil {
		q = q.Where("active = ?", *active)
	}
	var alerts []models.Alert
	respondPaged(c, q, p, "last_at desc", &alerts)
}

type ackAlertReq struct {
	Ack *bool `json:"ack"`
}

// PATCH /api/v1/alerts/:id — acknowledge (or reopen) one alert. Only the ack
// column is written: the engine updates the same row every tick (alerts.
// EvalFarm), and a whole-row save here could undo its newer active/lastAt.
func (a *API) ackAlert(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req ackAlertReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	var alert models.Alert
	if !a.findInFarm(c, farm.ID, &alert) {
		return
	}
	if req.Ack != nil {
		alert.Ack = *req.Ack
		if err := a.DB.Model(&alert).Update("ack", alert.Ack).Error; err != nil {
			serverError(c, err)
			return
		}
		a.audit(c, farm.ID, "alert.ack", alert.Kind+" → "+map[bool]string{true: "দেখা হয়েছে", false: "আবার খোলা"}[alert.Ack])
	}
	c.JSON(http.StatusOK, alert)
}
