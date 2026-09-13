package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Paged is the envelope every collection endpoint answers with. `page` is
// 1-based and `pages` is ceil(total/limit); clients that want "everything"
// (the dashboard/mobile lists) just request a high limit.
type Paged[T any] struct {
	Items []T   `json:"items"`
	Total int64 `json:"total"`
	Page  int   `json:"page"`
	Limit int   `json:"limit"`
	Pages int   `json:"pages"`
}

// paging is a parsed ?page=&limit= pair with the endpoint's defaults applied.
type paging struct{ page, limit int }

// parsePaging reads ?page (1-based, default 1) and ?limit (default defLimit,
// capped at maxLimit). Anything non-numeric or out of range is a 400.
func parsePaging(c *gin.Context, defLimit, maxLimit int) (paging, bool) {
	p := paging{page: 1, limit: defLimit}
	if v := c.Query("page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			badRequest(c, errInvalid("page", "a positive integer"))
			return p, false
		}
		p.page = n
	}
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxLimit {
			badRequest(c, errInvalid("limit", "1.."+strconv.Itoa(maxLimit)))
			return p, false
		}
		p.limit = n
	}
	return p, true
}

// respondPaged counts the filtered query, fetches one page (oldest/newest
// first per `order`, with the id as tie-break so rows never repeat or vanish
// between pages) and writes the Paged envelope. The model is taken from
// `out` (a *[]T) — Count needs it to resolve the table.
func respondPaged[T any](c *gin.Context, q *gorm.DB, p paging, order string, out *[]T) {
	var total int64
	if err := q.Session(&gorm.Session{}).Model(out).Count(&total).Error; err != nil {
		serverError(c, err)
		return
	}
	if err := q.Session(&gorm.Session{}).Model(out).Order(order + ", id").
		Offset((p.page - 1) * p.limit).Limit(p.limit).Find(out).Error; err != nil {
		serverError(c, err)
		return
	}
	if *out == nil {
		*out = []T{}
	}
	pages := int(math.Ceil(float64(total) / float64(p.limit)))
	c.JSON(http.StatusOK, Paged[T]{Items: *out, Total: total, Page: p.page, Limit: p.limit, Pages: pages})
}

// likeEscaper neutralises LIKE wildcards in user input so "50%" matches the
// literal text instead of everything.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// search applies a case-insensitive ?q= substring match across the given
// columns (OR-ed). Empty pattern is a no-op.
func search(q *gorm.DB, pattern string, columns ...string) *gorm.DB {
	if pattern == "" {
		return q
	}
	like := "%" + likeEscaper.Replace(strings.ToLower(pattern)) + "%"
	exprs := make([]string, len(columns))
	args := make([]any, len(columns))
	for i, col := range columns {
		exprs[i] = "lower(" + col + ") LIKE ? ESCAPE '\\'"
		args[i] = like
	}
	return q.Where(strings.Join(exprs, " OR "), args...)
}

// queryBool reads an optional ?name=true|false filter; anything else is a 400.
func queryBool(c *gin.Context, name string) (*bool, bool) {
	v := c.Query(name)
	if v == "" {
		return nil, true
	}
	if v != "true" && v != "false" {
		badRequest(c, errInvalid(name, "true or false"))
		return nil, false
	}
	b := v == "true"
	return &b, true
}

// queryEnum reads an optional ?name= filter that must be one of `allowed`
// (exact match); anything else is a 400.
func queryEnum(c *gin.Context, name string, allowed ...string) (string, bool) {
	v := c.Query(name)
	if v == "" {
		return "", true
	}
	for _, a := range allowed {
		if v == a {
			return v, true
		}
	}
	badRequest(c, errInvalid(name, "one of "+strings.Join(allowed, " | ")))
	return "", false
}

// queryInt64 reads an optional integer ?name= filter (e.g. epoch-ms range
// bounds); anything non-numeric is a 400.
func queryInt64(c *gin.Context, name string) (*int64, bool) {
	v := c.Query(name)
	if v == "" {
		return nil, true
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		badRequest(c, errInvalid(name, "an integer"))
		return nil, false
	}
	return &n, true
}

// errInvalid builds the error for a bad query parameter or body field
// (routed through badRequest so the body matches every other 400).
type queryError struct{ name, want string }

func (e queryError) Error() string {
	return "ইনপুট ঠিক নেই: " + e.name + " — " + e.want
}

func errInvalid(name, want string) error {
	return queryError{name: name, want: want}
}
