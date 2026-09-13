package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/models"
)

// Error responses all share one body, {"error": "<message>"}, so clients
// need a single parser. Messages are user-facing Bengali text (the dashboard
// and mobile app show them as-is).

// badRequest answers 400 for invalid input (413 when the body was over
// maxBodyBytes). Binding and JSON errors are rewritten into Bengali that
// names the JSON field — gin's own text ("Key: 'createTaskReq.Text' Error:…")
// leaks Go struct names and means nothing to a farmer.
func badRequest(c *gin.Context, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "অনুরোধ খুব বড়।"})
		return
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": inputMessage(err)})
}

func inputMessage(err error) string {
	var verrs validator.ValidationErrors
	var typeErr *json.UnmarshalTypeError
	var syntaxErr *json.SyntaxError
	switch {
	case errors.As(err, &verrs):
		parts := make([]string, len(verrs))
		for i, fe := range verrs {
			parts[i] = fe.Field() + " " + ruleText(fe)
		}
		return "ইনপুট ঠিক নেই: " + strings.Join(parts, "; ")
	case errors.As(err, &typeErr):
		return "ইনপুট ঠিক নেই: " + typeErr.Field + " ভুল ধরনের (" + typeErr.Type.String() + " চাই)"
	case errors.As(err, &syntaxErr), errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return "অনুরোধের JSON ঠিক নেই।"
	}
	return err.Error()
}

// ruleText explains one failed `binding:"…"` rule; it covers the tags the
// request structs use.
func ruleText(fe validator.FieldError) string {
	unit := ""
	if fe.Kind() == reflect.String {
		unit = " অক্ষর"
	}
	switch fe.Tag() {
	case "required":
		return "দিতে হবে"
	case "min":
		return "কমপক্ষে " + fe.Param() + unit
	case "max":
		return "সর্বোচ্চ " + fe.Param() + unit
	case "gt":
		return fe.Param() + "-এর বেশি হতে হবে"
	case "email":
		return "সঠিক ইমেইল নয়"
	case "oneof":
		return "এগুলোর একটা হতে হবে: " + fe.Param()
	}
	return "ঠিক নেই (" + fe.Tag() + ")"
}

// Validation errors name the JSON field (`text`), not the Go one (`Text`).
func init() {
	if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
		v.RegisterTagNameFunc(func(f reflect.StructField) string {
			name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
			if name == "" || name == "-" {
				return f.Name
			}
			return name
		})
	}
}

// unauthorized answers 401. RFC 9110 requires the challenge header; clients
// read it to know a bearer token (not a cookie) is wanted.
func unauthorized(c *gin.Context, msg string) {
	c.Header("WWW-Authenticate", `Bearer realm="farm-command"`)
	c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": msg})
}

func notFound(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"error": "পাওয়া যায়নি।"})
}

func forbidden(c *gin.Context, msg string) {
	c.JSON(http.StatusForbidden, gin.H{"error": msg})
}

// serverError logs the real cause and answers 500 with a generic message:
// database errors must not leak to clients.
func serverError(c *gin.Context, err error) {
	log.Printf("api: %s %s: %v", c.Request.Method, c.FullPath(), err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "সার্ভারে সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।"})
}

// findInFarm loads the row named by the :id path parameter into dst (a
// pointer to a model with a farm_id column), scoped to the farm. It answers
// 404 itself and reports false when there is no such row (500 when the
// database failed — an outage is not "not found").
func (a *API) findInFarm(c *gin.Context, farmID string, dst any) bool {
	err := a.DB.Where("farm_id = ? AND id = ?", farmID, c.Param("id")).First(dst).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		notFound(c)
		return false
	case err != nil:
		serverError(c, err)
		return false
	}
	return true
}

// deleteInFarm is the shared DELETE /<resource>/:id handler body: it removes
// the farm's row, records the audit entry and answers 204 (404 when absent).
// T is the model type, action the audit action name (e.g. "task.delete").
func deleteInFarm[T any](a *API, c *gin.Context, action string) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	var model T
	res := a.DB.Where("farm_id = ? AND id = ?", farm.ID, c.Param("id")).Delete(&model)
	if res.Error != nil {
		serverError(c, res.Error)
		return
	}
	if res.RowsAffected == 0 {
		notFound(c)
		return
	}
	a.audit(c, farm.ID, action, c.Param("id"))
	c.Status(http.StatusNoContent)
}

// filterTimeRange applies the shared ?from=&to= bounds (epoch ms) to the
// `at` column. It answers 400 itself and reports false on a malformed value.
func filterTimeRange(c *gin.Context, q *gorm.DB) (*gorm.DB, bool) {
	from, ok := queryInt64(c, "from")
	if !ok {
		return q, false
	}
	to, ok := queryInt64(c, "to")
	if !ok {
		return q, false
	}
	if from != nil {
		q = q.Where("at >= ?", *from)
	}
	if to != nil {
		q = q.Where("at <= ?", *to)
	}
	return q, true
}

// currentFarm loads the single farm row the clients operate on.
func (a *API) currentFarm(c *gin.Context) (*models.Farm, bool) {
	var farm models.Farm
	if err := a.DB.First(&farm).Error; err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ফার্ম পাওয়া যায়নি — আগে ডাটাবেস সিড করুন।"})
		return nil, false
	}
	c.Set("farmID", farm.ID) // publishWrites reads it after the handler
	return &farm, true
}

// unprocessable answers 422: the request is well-formed but the farm's data
// does not allow it (unknown field id, empty stock …).
func unprocessable(c *gin.Context, msg string) {
	c.JSON(http.StatusUnprocessableEntity, gin.H{"error": msg})
}

// fieldExists reports whether the farm has a field with this id.
func (a *API) fieldExists(farmID, fieldID string) bool {
	var n int64
	a.DB.Model(&models.Field{}).Where("farm_id = ? AND id = ?", farmID, fieldID).Count(&n)
	return n > 0
}

// --- idempotent creates (offline replay) -----------------------------------------
//
// The mobile app queues writes made without a connection and replays them
// later. A replay must never create a second row if the first attempt reached
// the server but its answer was lost, so tasks, ledger entries and
// observations accept an optional client-chosen `id` (the primary key): the
// second insert is a 409 and the app treats it as "already saved". Entries
// made offline also carry `at`, the time they were really made.

var clientIDRe = regexp.MustCompile(`^[A-Za-z0-9-]{6,40}$`)

// checkClientID accepts an empty id (the server picks one) or a well-formed one.
func checkClientID(id string) error {
	if id != "" && !clientIDRe.MatchString(id) {
		return errInvalid("id", "6-40 letters, digits or dashes")
	}
	return nil
}

// clientTime resolves a client-supplied epoch-ms timestamp: 0 means "now"; a
// value is accepted when it is not in the future (a little clock skew allowed)
// and not older than 90 days — an offline queue should not rewrite old books.
func clientTime(at int64, now time.Time) (int64, error) {
	if at == 0 {
		return now.UnixMilli(), nil
	}
	if at > now.Add(5*time.Minute).UnixMilli() || at < now.AddDate(0, 0, -90).UnixMilli() {
		return 0, errInvalid("at", "within the last 90 days, not in the future")
	}
	return at, nil
}

// isDuplicateKey reports a PostgreSQL unique violation (SQLSTATE 23505).
func isDuplicateKey(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// alreadySaved answers 409 for a replayed create.
func alreadySaved(c *gin.Context) {
	c.JSON(http.StatusConflict, gin.H{"error": "এটি আগেই সংরক্ষিত হয়েছে।"})
}
