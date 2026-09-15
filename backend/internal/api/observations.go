package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// --- observations (scouting notebook) --------------------------------------
//
// GET /api/v1/observations?page=&limit=&kind=&field=&q=&from=&to= — q matches the note;
// from/to bound `at` (epoch ms); newest first.

type createObservationReq struct {
	// ID and At are optional, for notes queued offline (see checkClientID / clientTime).
	ID string `json:"id"`
	At int64  `json:"at" binding:"min=0"`
	// gin's oneof splits on spaces, which the two-word kind "ঠিক আছে"
	// cannot survive — validated in the handler instead.
	Kind string `json:"kind" binding:"required"`
	Note string `json:"note" binding:"required"`
	// FieldID optionally ties the note to a field.
	FieldID string `json:"fieldId"`
}

func (a *API) listObservations(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if kind, ok := queryEnum(c, "kind", "ঠিক আছে", "পোকা", "রোগ"); !ok {
		return
	} else if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if field := c.Query("field"); field != "" {
		q = q.Where("field_id = ?", field)
	}
	if q, ok = filterTimeRange(c, q); !ok {
		return
	}
	q = search(q, c.Query("q"), "note")
	var obs []models.Observation
	respondPaged(c, q, p, "at desc", &obs)
}

func (a *API) createObservation(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createObservationReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	switch req.Kind {
	case "ঠিক আছে", "পোকা", "রোগ":
	default:
		badRequest(c, errInvalid("kind", "ঠিক আছে / পোকা / রোগ"))
		return
	}
	if err := checkClientID(req.ID); err != nil {
		badRequest(c, err)
		return
	}
	at, err := clientTime(req.At, time.Now())
	if err != nil {
		badRequest(c, err)
		return
	}
	if req.FieldID != "" && !a.fieldExists(farm.ID, req.FieldID) {
		unprocessable(c, "মাঠ পাওয়া যায়নি।")
		return
	}
	obs := models.Observation{ID: req.ID, FarmID: farm.ID, At: at, Kind: req.Kind, Note: req.Note, FieldID: req.FieldID}
	if err := a.DB.Create(&obs).Error; err != nil {
		if isDuplicateKey(err) {
			alreadySaved(c)
			return
		}
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "observation.create", req.Kind)
	c.JSON(http.StatusCreated, obs)
}
