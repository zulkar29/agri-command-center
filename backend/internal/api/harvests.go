package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// --- harvests --------------------------------------------------------------
//
// GET /api/v1/harvests?page=&limit=&q=&field=&from=&to= — newest first; q matches grade or note.

type createHarvestReq struct {
	FieldID    string  `json:"fieldId" binding:"required"`
	Kg         float64 `json:"kg" binding:"required,gt=0"`
	Grade      string  `json:"grade"`
	PricePerKg float64 `json:"pricePerKg" binding:"min=0"`
	Note       string  `json:"note"`
	// At is epoch ms; omitted/0 = now, the future is refused.
	At int64 `json:"at"`
	// AddIncome also books kg × pricePerKg as a ledger income tagged to the
	// field. Money is owner-only, so non-owners get 403 if they ask for it.
	AddIncome bool `json:"addIncome"`
}

func (a *API) listHarvests(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if field := c.Query("field"); field != "" {
		q = q.Where("field_id = ?", field)
	}
	if q, ok = filterTimeRange(c, q); !ok {
		return
	}
	q = search(q, c.Query("q"), "grade", "note")
	var rows []models.Harvest
	respondPaged(c, q, p, "at desc", &rows)
}

func (a *API) createHarvest(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createHarvestReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if req.AddIncome && currentUser(c).Role != models.RoleOwner {
		forbidden(c, "খাতায় আয় তুলতে মালিক হতে হবে।")
		return
	}
	now := time.Now()
	at := req.At
	if at <= 0 {
		at = now.UnixMilli()
	} else if at > now.Add(5*time.Minute).UnixMilli() {
		// a future harvest (and its income) would sit outside every report
		badRequest(c, errInvalid("at", "epoch ms, not in the future"))
		return
	}
	var field models.Field
	if err := a.DB.Where("farm_id = ? AND id = ?", farm.ID, req.FieldID).First(&field).Error; err != nil {
		unprocessable(c, "মাঠ পাওয়া যায়নি।")
		return
	}
	h := models.Harvest{
		FarmID: farm.ID, FieldID: field.ID, At: at,
		Kg: req.Kg, Grade: req.Grade, PricePerKg: req.PricePerKg, Note: req.Note,
	}
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&h).Error; err != nil {
			return err
		}
		if req.AddIncome && req.PricePerKg > 0 {
			return tx.Create(&models.LedgerEntry{
				FarmID: farm.ID, At: at, Type: "income", Cat: "ফসল বিক্রি",
				Amount:  req.Kg * req.PricePerKg,
				Note:    fmt.Sprintf("%s · %s কেজি", field.Crop, trimFloat(req.Kg)),
				FieldID: field.ID,
			}).Error
		}
		return nil
	})
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "harvest.create", field.Name+" "+trimFloat(req.Kg)+" কেজি")
	c.JSON(http.StatusCreated, h)
}

func (a *API) deleteHarvest(c *gin.Context) { deleteInFarm[models.Harvest](a, c, "harvest.delete") }
