package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// --- market prices -----------------------------------------------------------
//
// The owner's price book: what a crop fetched at a market on a day. It feeds
// the next-crop recommendation (GET /fields/:id/recommendations) until an
// official price source is wired in.
//
// GET /api/v1/market-prices?page=&limit=&q=&crop=&from=&to= — q matches crop
// or market; newest first.

type createMarketPriceReq struct {
	Crop       string  `json:"crop" binding:"required"`
	PricePerKg float64 `json:"pricePerKg" binding:"required,gt=0"`
	Market     string  `json:"market"`
	// At is the day the price was seen (epoch ms); default now.
	At int64 `json:"at" binding:"min=0"`
}

func (a *API) listMarketPrices(c *gin.Context) {
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
	if q, ok = filterTimeRange(c, q); !ok {
		return
	}
	q = search(q, c.Query("q"), "crop", "market")
	var rows []models.MarketPrice
	respondPaged(c, q, p, "at desc", &rows)
}

func (a *API) createMarketPrice(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createMarketPriceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	now := time.Now()
	if req.At == 0 {
		req.At = now.UnixMilli()
	} else if req.At > now.Add(5*time.Minute).UnixMilli() {
		badRequest(c, errInvalid("at", "epoch ms, not in the future"))
		return
	}
	row := models.MarketPrice{FarmID: farm.ID, Crop: req.Crop, At: req.At, PricePerKg: req.PricePerKg, Market: req.Market}
	if err := a.DB.Create(&row).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "market-price.create", fmt.Sprintf("%s %s ৳/কেজি", row.Crop, trimFloat(row.PricePerKg)))
	c.JSON(http.StatusCreated, row)
}

func (a *API) deleteMarketPrice(c *gin.Context) {
	deleteInFarm[models.MarketPrice](a, c, "market-price.delete")
}
