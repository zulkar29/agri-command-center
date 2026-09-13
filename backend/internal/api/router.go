// Package api wires the HTTP routes onto Gin.
//
// Conventions every handler follows:
//   - Everything is versioned under /api/v1 except the /api/health probe.
//     Resources are plural nouns (/tasks, /fields, /pump-runs); singletons
//     (/farm, /farm/pump) are singular. Things the farm "does" are modelled as
//     collections that get a new row (POST /farm/waterings, /farm/tank-fills);
//     only /auth/* keeps verbs.
//   - GET collections answer with the Paged envelope
//     {items,total,page,limit,pages} and take ?q=&page=&limit= plus
//     resource-specific filters; reads of one computed view live under
//     /reports/*.
//   - POST creates (201 + the new row; waterings/tank-fills answer with the
//     refreshed /farm snapshot, device commands with the relay row), PATCH
//     changes some fields (200 + the row), PUT replaces a singleton's state,
//     DELETE removes (204). PATCH and PUT are idempotent: they carry the
//     desired state, never "toggle".
//   - Errors are always {"error": "<user-facing message>"} with a fitting
//     status: 400 invalid input, 401 unauthenticated, 403 wrong role,
//     404 missing, 409 conflict, 422 unmet precondition, 5xx server.
//   - Who may call what is decided by the route groups in registerRoutes;
//     handlers add only data-dependent checks (e.g. owner-only fields).
package api

import (
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/live"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/weather"
)

// APIBase is the version prefix of every endpoint but /api/health. Bump it
// here (and API_PREFIX in dashboard/mobile services/http.ts) for a v2.
const APIBase = "/api/v1"

type API struct {
	DB *gorm.DB
	// JWTSecret signs access tokens; GoogleClientID enables Google sign-in.
	// Both come from AuthOptions.
	JWTSecret      []byte
	GoogleClientID string
	// RequireDeviceKey makes POST /api/v1/telemetry reject nodes that are
	// unknown or have no key set (production default; see AuthOptions).
	RequireDeviceKey bool
	// Weather serves GET /api/v1/weather and the engine's r1 rain-skip rule
	// (internal/weather); nil disables both.
	Weather *weather.Client
	// Live fans changes out to GET /api/v1/stream; nil disables the stream
	// (503) and makes every publish a no-op.
	Live *live.Hub
}

// AuthOptions carries the auth-related settings NewRouter needs.
type AuthOptions struct {
	// JWTSecret signs the access tokens; when nil a random secret is
	// generated per boot (tokens die on restart, refresh recovers).
	JWTSecret []byte
	// GoogleClientID enables "Sign in with Google" when non-empty.
	GoogleClientID string
	// RequireDeviceKey rejects telemetry from nodes without a configured
	// key — set in production, where fake readings would drive the pump.
	RequireDeviceKey bool
	// CORSOrigins lists the browser origins allowed to call the API
	// cross-origin; "*" allows all. Empty means same-origin only (the
	// dashboard is served by this server or proxied by Vite), which is the
	// safe default — native apps do not use CORS.
	CORSOrigins []string
}

// NewRouter builds the Gin engine with every endpoint mounted under /api/v1.
// hub is shared with the engine (main.go), which publishes its ticks to it.
// When staticDir points at a built dashboard (dashboard/dist), the same port
// also serves the SPA; non-/api GETs that match no file fall back to
// index.html so history-router deep links (/settings, /tasks…) work.
func NewRouter(db *gorm.DB, staticDir string, auth AuthOptions, wx *weather.Client, hub *live.Hub) *gin.Engine {
	r := gin.Default()
	r.HandleMethodNotAllowed = true

	if len(auth.CORSOrigins) > 0 {
		cfg := cors.Config{
			AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodOptions},
			AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Device-Key"},
		}
		if len(auth.CORSOrigins) == 1 && auth.CORSOrigins[0] == "*" {
			cfg.AllowAllOrigins = true // the bearer token, not the origin, is the gate
		} else {
			cfg.AllowOrigins = auth.CORSOrigins
		}
		r.Use(cors.New(cfg))
	}

	a := &API{DB: db, JWTSecret: auth.JWTSecret, GoogleClientID: auth.GoogleClientID, RequireDeviceKey: auth.RequireDeviceKey, Weather: wx, Live: hub}
	if hub != nil {
		hub.Snapshot = func(farmID string) (any, error) { return a.loadState(farmID) }
	}
	if len(a.JWTSecret) == 0 {
		a.JWTSecret = []byte(newToken()) // random per boot; refresh recovers
	}
	r.Use(noStore, limitBody)
	r.GET("/api/health", a.health) // unversioned: orchestrator probe
	a.registerRoutes(r.Group(APIBase))

	// unknown /api paths and wrong methods answer JSON like every other error
	r.NoMethod(func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "এই পথে এই মেথড চলে না।"})
	})
	if staticDir != "" {
		r.NoRoute(serveStatic(staticDir))
	} else {
		r.NoRoute(notFound)
	}
	return r
}

// registerRoutes is the whole route table, grouped by who may call.
// Roles: viewer (দর্শক) ⊂ operator (অপারেটর) ⊂ owner (মালিক).
func (a *API) registerRoutes(api *gin.RouterGroup) {
	// --- open: probes, auth entry points and device ingest -----------------
	// login/refresh/google carry their own credentials; devices cannot log in
	// as users and authenticate with their per-device X-Device-Key instead.
	api.GET("/auth/config", a.authConfig)
	// Credential endpoints are throttled per client IP against guessing.
	limited := api.Group("", newRateLimiter(10, time.Minute).middleware())
	limited.POST("/auth/login", a.login)
	limited.POST("/auth/refresh", a.refresh)
	limited.POST("/auth/google", a.google)
	api.POST("/telemetry", a.ingestTelemetry)

	authed := api.Group("", a.requireAuth)

	// --- any logged-in role: reads and own-account actions ------------------
	authed.GET("/auth/me", a.me)
	authed.PATCH("/auth/me", a.patchMe)
	authed.POST("/auth/logout", a.logout)
	authed.POST("/auth/password", a.changePassword)

	authed.GET("/farm", a.getFarm) // control snapshot; collections live below
	authed.GET("/fields", a.listFields)
	authed.GET("/tasks", a.listTasks)
	authed.GET("/ledger", a.listLedger)
	authed.GET("/stock", a.listStock)
	authed.GET("/schedules", a.listSchedules)
	authed.GET("/observations", a.listObservations)
	authed.GET("/harvests", a.listHarvests)
	authed.GET("/market-prices", a.listMarketPrices)
	authed.GET("/crop-templates", a.listCropTemplates)
	authed.GET("/fields/:id/recommendations", a.listRecommendations)
	authed.GET("/devices", a.listDevices)
	authed.GET("/alerts", a.listAlerts)
	authed.GET("/telemetry", a.listTelemetry)
	authed.GET("/telemetry/buckets", a.listTelemetryBuckets)
	authed.GET("/pump-runs", a.listPumpRuns)
	authed.GET("/reports/ledger-summary", a.ledgerSummary)
	authed.GET("/reports/field-profit", a.fieldProfitReport)
	authed.GET("/reports/weekly-summary", a.weeklySummary)
	authed.GET("/reports/water-use", a.waterUseReport)
	authed.GET("/reports/field-efficiency", a.fieldEfficiencyReport)
	authed.GET("/weather", a.getWeather)
	authed.GET("/stream", a.stream) // Server-Sent Events, see stream.go

	// --- operator + owner: irrigation, tasks, scouting, device commands -----
	// a.publishWrites tells open streams what a successful write changed
	oper := authed.Group("", requireRole(models.RoleOwner, models.RoleOperator), a.publishWrites)
	oper.PATCH("/farm", a.patchFarm) // owner-only fields are checked in the handler
	oper.PUT("/farm/pump", a.setPump)
	oper.POST("/farm/waterings", a.waterZones)
	oper.POST("/farm/tank-fills", a.fillTank)
	oper.PATCH("/rules/:id", a.patchRule)
	oper.PATCH("/alerts/:id", a.ackAlert)
	oper.POST("/devices/:id/commands", a.deviceCommand)

	oper.POST("/tasks", a.createTask)
	oper.PATCH("/tasks/:id", a.patchTask)
	oper.DELETE("/tasks/:id", a.deleteTask)

	oper.POST("/schedules", a.createSchedule)
	oper.PATCH("/schedules/:id", a.patchSchedule)
	oper.DELETE("/schedules/:id", a.deleteSchedule)

	oper.POST("/stock/:id/usages", a.useStock) // a cost additionally needs owner
	oper.POST("/observations", a.createObservation)
	oper.POST("/harvests", a.createHarvest) // addIncome additionally needs the owner role

	// --- owner only: money, land, stock and administration ------------------
	owner := authed.Group("", requireRole(models.RoleOwner), a.publishWrites)
	owner.POST("/fields", a.createField)
	owner.PATCH("/fields/:id", a.patchField)
	owner.DELETE("/fields/:id", a.deleteField)
	owner.POST("/crop-templates/:id/applications", a.applyCropTemplate)

	owner.POST("/ledger", a.createLedger)
	owner.DELETE("/ledger/:id", a.deleteLedger)
	owner.DELETE("/harvests/:id", a.deleteHarvest)

	owner.POST("/market-prices", a.createMarketPrice)
	owner.DELETE("/market-prices/:id", a.deleteMarketPrice)

	owner.POST("/stock", a.createStock)
	owner.PATCH("/stock/:id", a.patchStock)
	owner.DELETE("/stock/:id", a.deleteStock)

	owner.GET("/users", a.listUsers)
	owner.POST("/users", a.createUser)
	owner.PATCH("/users/:id", a.patchUser)
	owner.DELETE("/users/:id", a.deleteUser)
	owner.GET("/devices/:id/key", a.deviceKey)
	owner.POST("/devices/:id/key", a.rotateDeviceKey)
	owner.GET("/audit", a.listAudit)
}

// health (GET /api/health) is the liveness/readiness probe: 200 only while the database answers.
func (a *API) health(c *gin.Context) {
	sqlDB, err := a.DB.DB()
	if err == nil {
		err = sqlDB.PingContext(c.Request.Context())
	}
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "database unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// serveStatic serves files from the built dashboard; any non-/api GET that
// does not match a file falls back to index.html, which is what makes the
// history router's deep links (/irrigation etc.) load the app.
func serveStatic(dir string) gin.HandlerFunc {
	fs := http.Dir(dir)
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet || strings.HasPrefix(c.Request.URL.Path, "/api/") {
			notFound(c)
			return
		}
		upath := path.Clean(c.Request.URL.Path)
		if f, err := fs.Open(upath); err == nil {
			fi, statErr := f.Stat()
			_ = f.Close()
			if statErr == nil && !fi.IsDir() {
				c.FileFromFS(upath, fs)
				return
			}
		}
		c.File(filepath.Join(dir, "index.html"))
	}
}

// maxBodyBytes caps request bodies; the largest real one (a telemetry
// reading or a ledger entry) is well under a kilobyte.
const maxBodyBytes = 1 << 20

// limitBody makes an oversized body fail binding, which badRequest turns
// into a 413.
func limitBody(c *gin.Context) {
	if c.Request.Body != nil {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	}
	c.Next()
}

// noStore keeps tokens, device keys and live readings out of shared caches.
func noStore(c *gin.Context) {
	if strings.HasPrefix(c.Request.URL.Path, "/api/") {
		c.Header("Cache-Control", "no-store")
	}
	c.Next()
}
