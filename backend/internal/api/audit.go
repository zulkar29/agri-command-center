package api

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/models"
)

// audit records who did what. Failures only log — an audit
// hiccup must never fail the action it describes. FarmID is empty for
// user-administration events, which are not farm-scoped.
func (a *API) audit(c *gin.Context, farmID, action, detail string) {
	user := currentUser(c)
	if user == nil {
		return
	}
	entry := models.AuditLog{
		FarmID: farmID, UserID: user.ID, UserName: user.Name,
		Action: action, Detail: detail, At: time.Now().UnixMilli(),
	}
	if err := a.DB.Create(&entry).Error; err != nil {
		log.Printf("audit: writing %s: %v", action, err)
	}
}

// GET /api/v1/audit?page=&limit=&q=&action=&from=&to= — newest first (owner
// only). q matches the user name or detail; action is an exact match such as
// pump.on; from/to bound the entry time (epoch ms). User-administration
// entries (no farm, see audit) are part of this single farm's log too.
func (a *API) listAudit(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id IN ?", []string{farm.ID, ""})
	if action := c.Query("action"); action != "" {
		q = q.Where("action = ?", action)
	}
	if q, ok = filterTimeRange(c, q); !ok {
		return
	}
	q = search(q, c.Query("q"), "user_name", "detail")
	var rows []models.AuditLog
	respondPaged(c, q, p, "at desc", &rows)
}
