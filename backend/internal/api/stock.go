package api

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// --- stock ----------------------------------------------------------------
//
// GET /api/v1/stock?page=&limit=&q=&low= — low=true is the shopping list:
// items with a minimum set (min > 0) that are at or below it (models.StockItem
// IsLow, the same test the low-stock alert uses); q matches name.

type createStockReq struct {
	Name string  `json:"name" binding:"required,max=100"`
	Unit string  `json:"unit" binding:"required,max=30"`
	Qty  float64 `json:"qty" binding:"min=0"`
	Min  float64 `json:"min" binding:"min=0"`
}

func (a *API) listStock(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if low, ok := queryBool(c, "low"); !ok {
		return
	} else if low != nil && *low {
		q = q.Where("min > 0 AND qty <= min")
	}
	q = search(q, c.Query("q"), "name")
	var stock []models.StockItem
	respondPaged(c, q, p, "created_at", &stock)
}

func (a *API) createStock(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createStockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	item := models.StockItem{FarmID: farm.ID, Name: req.Name, Unit: req.Unit, Qty: req.Qty, Min: req.Min}
	if err := a.DB.Create(&item).Error; err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "stock.create", item.Name)
	c.JSON(http.StatusCreated, item)
}

type patchStockReq struct {
	// Delta adjusts qty (like the dashboard's +/- buttons); Qty sets it directly.
	Delta *float64 `json:"delta"`
	Qty   *float64 `json:"qty"`
	Min   *float64 `json:"min"`
}

func (a *API) patchStock(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchStockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if (req.Qty != nil && *req.Qty < 0) || (req.Min != nil && *req.Min < 0) {
		badRequest(c, errInvalid("qty/min", "not negative"))
		return
	}
	var item models.StockItem
	if !a.findInFarm(c, farm.ID, &item) {
		return
	}
	// qty is computed in SQL so two quick +/- taps (or a usage landing at the
	// same time) both count instead of the later write winning
	updates := map[string]any{}
	switch {
	case req.Qty != nil:
		updates["qty"] = *req.Qty
	case req.Delta != nil:
		updates["qty"] = gorm.Expr("GREATEST(qty + ?, 0)", *req.Delta)
	}
	if req.Min != nil {
		updates["min"] = *req.Min
	}
	if len(updates) > 0 {
		if err := a.DB.Model(&item).Updates(updates).Error; err != nil {
			serverError(c, err)
			return
		}
		if err := a.DB.First(&item, "id = ?", item.ID).Error; err != nil {
			serverError(c, err)
			return
		}
	}
	a.audit(c, farm.ID, "stock.adjust", fmt.Sprintf("%s → %s %s", item.Name, trimFloat(item.Qty), item.Unit))
	c.JSON(http.StatusOK, item)
}

type useStockReq struct {
	Qty float64 `json:"qty" binding:"required,gt=0"`
	// FieldID is the field it was used on; Cost (৳, owner only) books an
	// expense in the ledger tagged to that field, under Cat.
	FieldID string  `json:"fieldId"`
	Cost    float64 `json:"cost" binding:"min=0"`
	Cat     string  `json:"cat"`
}

// POST /api/v1/stock/:id/usages — record using Qty of an item: stock goes
// down and, with a cost, the ledger gains an expense for the field. Answers
// 201 with the updated item (and the ledger row, if one was made).
func (a *API) useStock(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req useStockReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if req.Cost > 0 && currentUser(c).Role != models.RoleOwner {
		forbidden(c, "খরচ খাতায় তুলতে মালিক হতে হবে।")
		return
	}
	if req.FieldID != "" && !a.fieldExists(farm.ID, req.FieldID) {
		unprocessable(c, "মাঠ পাওয়া যায়নি।")
		return
	}
	var item models.StockItem
	if !a.findInFarm(c, farm.ID, &item) {
		return
	}
	var entry *models.LedgerEntry
	errShort := errors.New("not enough stock")
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		// check and decrement in one statement: two usages at once must not
		// both pass a check made on the same old quantity
		res := tx.Model(&item).Where("qty >= ?", req.Qty).Update("qty", gorm.Expr("qty - ?", req.Qty))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errShort
		}
		if err := tx.First(&item, "id = ?", item.ID).Error; err != nil {
			return err
		}
		if req.Cost > 0 {
			cat := req.Cat
			if cat == "" {
				cat = "অন্যান্য"
			}
			entry = &models.LedgerEntry{
				FarmID: farm.ID, At: time.Now().UnixMilli(), Type: "expense", Cat: cat, Amount: req.Cost,
				Note: fmt.Sprintf("%s · %s %s", item.Name, trimFloat(req.Qty), item.Unit), FieldID: req.FieldID,
			}
			return tx.Create(entry).Error
		}
		return nil
	})
	if errors.Is(err, errShort) {
		a.DB.First(&item, "id = ?", item.ID) // report the quantity as it is now
		unprocessable(c, fmt.Sprintf("মজুতে মাত্র %s %s আছে।", trimFloat(item.Qty), item.Unit))
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "stock.use", fmt.Sprintf("%s −%s %s", item.Name, trimFloat(req.Qty), item.Unit))
	c.JSON(http.StatusCreated, gin.H{"item": item, "ledger": entry})
}

func (a *API) deleteStock(c *gin.Context) { deleteInFarm[models.StockItem](a, c, "stock.delete") }

// trimFloat renders audit quantities without trailing zeros (18, 1.5 …).
func trimFloat(v float64) string {
	if v == float64(int(v)) {
		return fmt.Sprintf("%d", int(v))
	}
	return fmt.Sprintf("%.1f", v)
}
