package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/crops"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/recommend"
)

// --- crop calendar and next-crop advice ----------------------------------------
//
// GET  /api/v1/crop-templates                       — the built-in crop calendar
// POST /api/v1/crop-templates/:id/applications      — plant a template on a field
// GET  /api/v1/fields/:id/recommendations?month=    — what to grow there next

func (a *API) listCropTemplates(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"items": crops.All()})
}

type applyTemplateReq struct {
	FieldID string `json:"fieldId" binding:"required"`
}

// applyCropTemplate plants a template on a field: the field takes the crop's
// name and harvest time, its age restarts, and the template's jobs become
// dated tasks. 201 with the field and the created tasks.
func (a *API) applyCropTemplate(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	tpl, found := crops.ByID(c.Param("id"))
	if !found {
		notFound(c)
		return
	}
	var req applyTemplateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	var field models.Field
	if err := a.DB.Where("farm_id = ? AND id = ?", farm.ID, req.FieldID).First(&field).Error; err != nil {
		unprocessable(c, "মাঠ পাওয়া যায়নি।")
		return
	}
	now := time.Now()
	who := currentUser(c).Name
	tasks := make([]models.Task, len(tpl.Tasks))
	for i, t := range tpl.Tasks {
		dueAt := endOfDay(now.AddDate(0, 0, t.Day))
		tasks[i] = models.Task{
			FarmID: farm.ID, Text: t.Text, Who: who, FieldID: field.ID,
			DueAt: dueAt, Due: dueLabel(dueAt, now),
		}
	}
	field.Crop, field.HarvestAt, field.Age = tpl.Name, tpl.DaysToHarvest, 0
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&field).Error; err != nil {
			return err
		}
		if len(tasks) == 0 {
			return nil
		}
		return tx.Create(&tasks).Error
	})
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "field.plant", field.Name+" · "+tpl.Name)
	c.JSON(http.StatusCreated, gin.H{"field": field, "tasks": tasks})
}

// endOfDay is 23:59 on t's calendar day in Dhaka: a job planned "for day N" is
// due by the end of that day, not at the instant it was planned.
func endOfDay(t time.Time) int64 {
	d := t.In(models.FarmZone)
	return time.Date(d.Year(), d.Month(), d.Day(), 23, 59, 0, 0, models.FarmZone).UnixMilli()
}

// problemWindow is how far back pest/disease notes count against a field.
const problemWindow = 120 * 24 * time.Hour

// listRecommendations ranks the next crop for a field (internal/recommend):
// season, rotation (with recent problem notes), water and the price book.
func (a *API) listRecommendations(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var field models.Field
	if !a.findInFarm(c, farm.ID, &field) {
		return
	}
	now := time.Now()
	month := int(now.In(models.FarmZone).Month())
	if v := c.Query("month"); v != "" {
		m, err := strconv.Atoi(v)
		if err != nil || m < 1 || m > 12 {
			badRequest(c, errInvalid("month", "1..12"))
			return
		}
		month = m
	}
	var problems int64
	if err := a.DB.Model(&models.Observation{}).
		Where("farm_id = ? AND field_id = ? AND kind IN ? AND at >= ?", farm.ID, field.ID, []string{"পোকা", "রোগ"}, now.Add(-problemWindow).UnixMilli()).
		Count(&problems).Error; err != nil {
		serverError(c, err)
		return
	}
	var book []models.MarketPrice
	if err := a.DB.Where("farm_id = ?", farm.ID).Order("at desc").Limit(500).Find(&book).Error; err != nil {
		serverError(c, err)
		return
	}
	prices := make([]recommend.Price, len(book))
	for i, p := range book {
		prices[i] = recommend.Price{Crop: p.Crop, PricePerKg: p.PricePerKg, At: p.At}
	}
	ranked := recommend.Rank(recommend.Input{
		Month: month, CurrentCrop: field.Crop, ProblemNotes: int(problems), TankPct: farm.Tank, Prices: prices,
	})
	c.JSON(http.StatusOK, gin.H{"field": field.ID, "crop": field.Crop, "month": month, "items": ranked})
}
