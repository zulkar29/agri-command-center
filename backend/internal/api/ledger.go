package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// --- ledger ---------------------------------------------------------------
//
// GET /api/v1/ledger?page=&limit=&q=&type=&cat=&field=&from=&to= — q matches
// note or cat; from/to bound `at` (epoch ms); newest first.

type createLedgerReq struct {
	// ID and At are optional, for entries queued offline (see checkClientID / clientTime).
	ID     string  `json:"id"`
	At     int64   `json:"at" binding:"min=0"`
	Type   string  `json:"type" binding:"required,oneof=income expense"`
	Cat    string  `json:"cat" binding:"required"`
	Amount float64 `json:"amount" binding:"required,gt=0"`
	Note   string  `json:"note"`
	// FieldID optionally tags the entry to a field.
	FieldID string `json:"fieldId"`
}

func (a *API) listLedger(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if typ, ok := queryEnum(c, "type", "income", "expense"); !ok {
		return
	} else if typ != "" {
		q = q.Where("type = ?", typ)
	}
	if cat := c.Query("cat"); cat != "" {
		q = q.Where("cat = ?", cat)
	}
	if field := c.Query("field"); field != "" {
		q = q.Where("field_id = ?", field)
	}
	if q, ok = filterTimeRange(c, q); !ok {
		return
	}
	q = search(q, c.Query("q"), "note", "cat")
	var ledger []models.LedgerEntry
	respondPaged(c, q, p, "at desc", &ledger)
}

func (a *API) createLedger(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createLedgerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
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
	entry := models.LedgerEntry{
		ID: req.ID, FarmID: farm.ID, At: at,
		Type: req.Type, Cat: req.Cat, Amount: req.Amount, Note: req.Note, FieldID: req.FieldID,
	}
	if err := a.DB.Create(&entry).Error; err != nil {
		if isDuplicateKey(err) {
			alreadySaved(c)
			return
		}
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "ledger.create", req.Type+" "+fmt.Sprintf("%.0f", req.Amount)+" ৳")
	c.JSON(http.StatusCreated, entry)
}

func (a *API) deleteLedger(c *gin.Context) { deleteInFarm[models.LedgerEntry](a, c, "ledger.delete") }

type categoryTotal struct {
	Type  string  `json:"type"`
	Cat   string  `json:"cat"`
	Total float64 `json:"total"`
}

// GET /api/v1/reports/ledger-summary?from=&to= — whole-ledger totals computed
// in SQL, so they stay right beyond the 200-row page the lists show.
func (a *API) ledgerSummary(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	q, ok := filterTimeRange(c, a.DB.Model(&models.LedgerEntry{}).Where("farm_id = ?", farm.ID))
	if !ok {
		return
	}
	rows := []categoryTotal{}
	if err := q.Select("type, cat, sum(amount) AS total").Group("type, cat").Order("type, total DESC, cat").Scan(&rows).Error; err != nil {
		serverError(c, err)
		return
	}
	var income, expense float64
	for _, r := range rows {
		if r.Type == "income" {
			income += r.Total
		} else {
			expense += r.Total
		}
	}
	c.JSON(http.StatusOK, gin.H{"income": income, "expense": expense, "profit": income - expense, "byCategory": rows})
}

type fieldProfit struct {
	// FieldID is "" for entries that carry no field tag.
	FieldID string  `json:"fieldId"`
	Name    string  `json:"name"`
	Crop    string  `json:"crop"`
	Area    float64 `json:"area"`
	Income  float64 `json:"income"`
	Expense float64 `json:"expense"`
	Profit  float64 `json:"profit"`
	// ProfitPerShotok is profit per শতক of the field (nil without an area).
	ProfitPerShotok *float64 `json:"profitPerShotok"`
}

// GET /api/v1/reports/field-profit?from=&to= — income, expense and profit per
// field from the ledger entries tagged with it, plus a row for untagged
// entries, so crop-by-crop profit does not depend on page size.
func (a *API) fieldProfitReport(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	q, ok := filterTimeRange(c, a.DB.Model(&models.LedgerEntry{}).Where("farm_id = ?", farm.ID))
	if !ok {
		return
	}
	type row struct {
		FieldID string
		Type    string
		Total   float64
	}
	var rows []row
	if err := q.Select("field_id, type, sum(amount) AS total").Group("field_id, type").Scan(&rows).Error; err != nil {
		serverError(c, err)
		return
	}
	var fields []models.Field
	if err := a.DB.Where("farm_id = ?", farm.ID).Order("created_at, id").Find(&fields).Error; err != nil {
		serverError(c, err)
		return
	}
	byID := map[string]*fieldProfit{}
	items := make([]*fieldProfit, 0, len(fields)+1)
	for _, f := range fields {
		fp := &fieldProfit{FieldID: f.ID, Name: f.Name, Crop: f.Crop, Area: f.Area}
		byID[f.ID] = fp
		items = append(items, fp)
	}
	untagged := &fieldProfit{}
	for _, r := range rows {
		fp, ok := byID[r.FieldID]
		if !ok {
			fp = untagged // no tag, or a field deleted since
		}
		if r.Type == "income" {
			fp.Income += r.Total
		} else {
			fp.Expense += r.Total
		}
	}
	items = append(items, untagged)
	out := make([]fieldProfit, 0, len(items))
	for _, fp := range items {
		if fp.FieldID == "" && fp.Income == 0 && fp.Expense == 0 {
			continue // nothing untagged — leave the row out
		}
		fp.Profit = fp.Income - fp.Expense
		if fp.Area > 0 {
			v := fp.Profit / fp.Area
			fp.ProfitPerShotok = &v
		}
		out = append(out, *fp)
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}
