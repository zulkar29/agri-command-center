package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// --- fields ------------------------------------------------------------
//
// GET /api/v1/fields?page=&limit=&q=&crop= — q matches name or crop.

type createFieldReq struct {
	Name      string  `json:"name" binding:"required,max=100"`
	Crop      string  `json:"crop" binding:"required,max=60"`
	Area      float64 `json:"area" binding:"min=0"`
	Plants    int     `json:"plants" binding:"min=0"`
	HarvestAt int     `json:"harvestAt" binding:"min=1"`
	// Zone links the field to a watering zone index (optional).
	Zone *int `json:"zone" binding:"omitempty,min=0"`
}

func (a *API) listFields(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if crop := c.Query("crop"); crop != "" {
		q = q.Where("crop = ?", crop)
	}
	q = search(q, c.Query("q"), "name", "crop")
	var fields []models.Field
	respondPaged(c, q, p, "created_at", &fields)
}

func (a *API) createField(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createFieldReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	field := models.Field{
		FarmID: farm.ID, Name: req.Name, Crop: req.Crop,
		Area: req.Area, Plants: req.Plants, Age: 0, HarvestAt: req.HarvestAt, Zone: req.Zone,
	}
	if err := a.DB.Create(&field).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "field.create", field.Name)
	c.JSON(http.StatusCreated, field)
}

type patchFieldReq struct {
	Name      *string  `json:"name"`
	Crop      *string  `json:"crop"`
	Area      *float64 `json:"area"`
	Plants    *int     `json:"plants"`
	HarvestAt *int     `json:"harvestAt"`
	// Zone: a number links the field to that watering zone; -1 unlinks it.
	Zone *int `json:"zone"`
}

// PATCH /api/v1/fields/:id — correct or re-plant a field without losing its
// ledger, harvest and water history.
func (a *API) patchField(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchFieldReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if (req.Name != nil && (strings.TrimSpace(*req.Name) == "" || len(*req.Name) > 100)) ||
		(req.Crop != nil && (strings.TrimSpace(*req.Crop) == "" || len(*req.Crop) > 60)) ||
		(req.Area != nil && *req.Area < 0) || (req.Plants != nil && *req.Plants < 0) ||
		(req.HarvestAt != nil && *req.HarvestAt < 1) || (req.Zone != nil && *req.Zone < -1) {
		badRequest(c, errInvalid("name/crop/area/plants/harvestAt/zone", "non-empty name and crop, non-negative numbers, harvestAt >= 1"))
		return
	}
	var field models.Field
	if !a.findInFarm(c, farm.ID, &field) {
		return
	}
	if req.Name != nil {
		field.Name = *req.Name
	}
	if req.Crop != nil {
		field.Crop = *req.Crop
	}
	if req.Area != nil {
		field.Area = *req.Area
	}
	if req.Plants != nil {
		field.Plants = *req.Plants
	}
	if req.HarvestAt != nil {
		field.HarvestAt = *req.HarvestAt
	}
	if req.Zone != nil {
		if *req.Zone == -1 {
			field.Zone = nil
		} else {
			field.Zone = req.Zone
		}
	}
	if err := a.DB.Save(&field).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "field.update", field.Name)
	c.JSON(http.StatusOK, field)
}

func (a *API) deleteField(c *gin.Context) { deleteInFarm[models.Field](a, c, "field.delete") }
