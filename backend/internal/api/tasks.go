package api

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// --- tasks ---------------------------------------------------------------
//
// GET /api/v1/tasks?page=&limit=&q=&done=&urgent=&due=&overdue=&field= — q
// matches text or who; overdue=true lists open tasks whose dueAt has passed;
// soonest deadline first, then newest.
//
// A task has a coarse label (due: আজ | কাল | এই সপ্তাহ | পরে) and, optionally,
// an exact deadline (dueAt, epoch ms). Send either: with dueAt the label is
// derived from it; with only the label dueAt stays 0. repeatDays > 0 makes it
// recur — completing it creates the next one that many days later.

var dueLabels = []string{"আজ", "কাল", "এই সপ্তাহ", "পরে"}

type createTaskReq struct {
	// ID is optional: an offline client picks it so a replayed create is a 409, not a duplicate.
	ID   string `json:"id"`
	Text string `json:"text" binding:"required"`
	Who  string `json:"who" binding:"required"`
	// Due is checked in the handler: gin's oneof splits on spaces, which the
	// two-word label "এই সপ্তাহ" cannot survive (it was always a 400).
	Due        string `json:"due"`
	DueAt      int64  `json:"dueAt" binding:"min=0"`
	RepeatDays int    `json:"repeatDays" binding:"min=0,max=365"`
	FieldID    string `json:"fieldId"`
	Urgent     bool   `json:"urgent"`
}

// dueLabel buckets a deadline into the coarse label, by Dhaka calendar days
// from now (past deadlines read আজ — they are shown as overdue separately).
func dueLabel(dueAtMs int64, now time.Time) string {
	today := now.In(models.FarmZone)
	d := time.UnixMilli(dueAtMs).In(models.FarmZone)
	days := int(time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, models.FarmZone).Sub(
		time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, models.FarmZone)).Hours() / 24)
	switch {
	case days <= 0:
		return "আজ"
	case days == 1:
		return "কাল"
	case days <= 7:
		return "এই সপ্তাহ"
	}
	return "পরে"
}

func (a *API) listTasks(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 50, 200)
	if !ok {
		return
	}
	q := a.DB.Where("farm_id = ?", farm.ID)
	if done, ok := queryBool(c, "done"); !ok {
		return
	} else if done != nil {
		q = q.Where("done = ?", *done)
	}
	if urgent, ok := queryBool(c, "urgent"); !ok {
		return
	} else if urgent != nil {
		q = q.Where("urgent = ?", *urgent)
	}
	if overdue, ok := queryBool(c, "overdue"); !ok {
		return
	} else if overdue != nil && *overdue {
		q = q.Where("done = ? AND due_at > 0 AND due_at < ?", false, time.Now().UnixMilli())
	}
	if field := c.Query("field"); field != "" {
		q = q.Where("field_id = ?", field)
	}
	if due, ok := queryEnum(c, "due", dueLabels...); !ok {
		return
	} else if due != "" {
		q = q.Where("due = ?", due)
	}
	q = search(q, c.Query("q"), "text", "who")
	var tasks []models.Task
	// open tasks with a deadline first, soonest to latest; the rest newest first
	respondPaged(c, q, p, "done, (due_at = 0), due_at, created_at desc", &tasks)
}

func (a *API) createTask(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req createTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if err := checkClientID(req.ID); err != nil {
		badRequest(c, err)
		return
	}
	if req.Due != "" && !slices.Contains(dueLabels, req.Due) {
		badRequest(c, errInvalid("due", strings.Join(dueLabels, " | ")))
		return
	}
	if req.Due == "" && req.DueAt == 0 {
		badRequest(c, errInvalid("due", "a label or dueAt"))
		return
	}
	if req.FieldID != "" && !a.fieldExists(farm.ID, req.FieldID) {
		unprocessable(c, "মাঠ পাওয়া যায়নি।")
		return
	}
	now := time.Now()
	if req.DueAt > 0 {
		req.Due = dueLabel(req.DueAt, now)
	}
	task := models.Task{
		ID: req.ID, FarmID: farm.ID, Text: req.Text, Who: req.Who, Due: req.Due, DueAt: req.DueAt,
		RepeatDays: req.RepeatDays, FieldID: req.FieldID, Urgent: req.Urgent,
	}
	if err := a.DB.Create(&task).Error; err != nil {
		if isDuplicateKey(err) {
			alreadySaved(c)
			return
		}
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "task.create", task.Text)
	c.JSON(http.StatusCreated, task)
}

type patchTaskReq struct {
	Text       *string `json:"text"`
	Done       *bool   `json:"done"`
	Urgent     *bool   `json:"urgent"`
	DueAt      *int64  `json:"dueAt"`
	RepeatDays *int    `json:"repeatDays"`
}

func (a *API) patchTask(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var req patchTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}
	if req.Text != nil && strings.TrimSpace(*req.Text) == "" {
		badRequest(c, errInvalid("text", "not empty"))
		return
	}
	if (req.DueAt != nil && *req.DueAt < 0) || (req.RepeatDays != nil && (*req.RepeatDays < 0 || *req.RepeatDays > 365)) {
		badRequest(c, errInvalid("dueAt/repeatDays", "dueAt >= 0, repeatDays 0..365"))
		return
	}
	var task models.Task
	if !a.findInFarm(c, farm.ID, &task) {
		return
	}
	if req.Text != nil {
		task.Text = *req.Text
	}
	justDone := req.Done != nil && *req.Done && !task.Done
	if req.Done != nil {
		task.Done = *req.Done
	}
	if req.Urgent != nil {
		task.Urgent = *req.Urgent
	}
	now := time.Now()
	if req.DueAt != nil {
		task.DueAt = *req.DueAt
		if task.DueAt > 0 {
			task.Due = dueLabel(task.DueAt, now)
		}
	}
	if req.RepeatDays != nil {
		task.RepeatDays = *req.RepeatDays
	}
	err := a.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(&task).Error; err != nil {
			return err
		}
		if justDone && task.RepeatDays > 0 {
			return tx.Create(nextTask(task, now)).Error
		}
		return nil
	})
	if err != nil {
		serverError(c, err)
		return
	}
	a.audit(c, farm.ID, "task.update", task.Text)
	c.JSON(http.StatusOK, task)
}

// nextTask is the follow-up of a finished repeating task: same text, due
// RepeatDays after the old deadline (or after today if it had none, or if
// that would already be in the past — a late spray is not due "yesterday").
func nextTask(done models.Task, now time.Time) *models.Task {
	base := now
	if done.DueAt > 0 {
		base = time.UnixMilli(done.DueAt)
	}
	due := base.AddDate(0, 0, done.RepeatDays)
	if due.Before(now) {
		due = now.AddDate(0, 0, done.RepeatDays)
	}
	next := done
	next.ID, next.Done, next.CreatedAt = "", false, time.Time{}
	next.DueAt = due.UnixMilli()
	next.Due = dueLabel(next.DueAt, now)
	return &next
}

func (a *API) deleteTask(c *gin.Context) { deleteInFarm[models.Task](a, c, "task.delete") }
