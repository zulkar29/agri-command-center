// Package config reads runtime settings from the environment.
package config

import (
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// DSN is the PostgreSQL connection string: DATABASE_URL as given (URL or
	// key/value form) or a key/value string assembled from DB_*.
	DSN string
	// HTTP port the API listens on.
	Port string
	// SeedDemoData inserts demo data when the database is empty.
	SeedDemoData bool
	// StaticDir serves the built dashboard (dashboard/dist) when set; the
	// same port then serves both the /api routes and the SPA.
	StaticDir string
	// JWTSecret signs the access tokens. Empty → a random secret per boot:
	// access tokens die on restart but clients recover via refresh.
	JWTSecret string
	// GoogleClientID enables "Sign in with Google" (verified server-side)
	// when set; leave empty to disable the option.
	GoogleClientID string
	// EngineInterval is the irrigation engine's tick cadence
	// (backend/internal/engine); ENGINE_INTERVAL accepts Go durations
	// like 30s or 1m. Zero/non-parsable → engine.DefaultInterval.
	EngineInterval time.Duration
	// TelemetryRetentionDays drops telemetry older than this many days
	// (TimescaleDB retention policy); 0 keeps everything.
	TelemetryRetentionDays int
	// Env is the deployment flavour; "production" turns on hard requirements
	// (e.g. JWT_SECRET must be set — see cmd/server/main.go).
	Env string
	// TelegramBotToken + TelegramChatID deliver alert activations to one
	// Telegram chat (internal/alerts). Either empty → Telegram disabled.
	TelegramBotToken string
	TelegramChatID   string
	// SMSGatewayURL (+ optional SMSGatewayToken) enables SMS alerts through a
	// generic HTTP gateway (internal/notify). Empty → SMS disabled.
	SMSGatewayURL   string
	SMSGatewayToken string
	// RequireDeviceKey refuses telemetry from nodes with no device key.
	// Default on when Env is production; REQUIRE_DEVICE_KEY=true/false overrides.
	RequireDeviceKey bool
	// CORSOrigins is CORS_ORIGINS, comma-separated ("*" = any). Empty keeps
	// the API same-origin only.
	CORSOrigins []string
}

// Load builds the config from environment variables with dev-friendly defaults.
// DATABASE_URL (postgres://user:pass@host:port/dbname) is accepted directly;
// otherwise discrete DB_* variables are assembled into a DSN.
func Load() Config {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = assembleDSN()
	}
	if !strings.Contains(dsn, "TimeZone=") && !isURLForm(dsn) {
		dsn += " TimeZone=Asia/Dhaka"
	}

	seed := true
	if v := os.Getenv("SEED_DEMO_DATA"); v != "" {
		seed, _ = strconv.ParseBool(v)
	}

	retention, _ := strconv.Atoi(os.Getenv("TELEMETRY_RETENTION_DAYS"))
	if retention < 0 {
		retention = 0
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	env := os.Getenv("ENV")
	requireKey := env == "production"
	if v := os.Getenv("REQUIRE_DEVICE_KEY"); v != "" {
		// a typo ("yes", "on") must not quietly open telemetry in production
		if b, err := strconv.ParseBool(v); err == nil {
			requireKey = b
		} else {
			log.Printf("REQUIRE_DEVICE_KEY=%q is not true/false — keeping %v", v, requireKey)
		}
	}

	var origins []string
	for _, o := range strings.Split(os.Getenv("CORS_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}

	return Config{
		CORSOrigins:      origins,
		RequireDeviceKey: requireKey,
		DSN:              dsn, Port: port, SeedDemoData: seed, StaticDir: os.Getenv("STATIC_DIR"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
		GoogleClientID: os.Getenv("GOOGLE_CLIENT_ID"),
		EngineInterval: parseDuration(os.Getenv("ENGINE_INTERVAL")),

		TelemetryRetentionDays: retention,

		Env:              env,
		TelegramBotToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		TelegramChatID:   os.Getenv("TELEGRAM_CHAT_ID"),

		SMSGatewayURL:   os.Getenv("SMS_GATEWAY_URL"),
		SMSGatewayToken: os.Getenv("SMS_GATEWAY_TOKEN"),
	}
}

// parseDuration accepts Go duration strings, returning 0 for anything else
// (the engine substitutes its default).
func parseDuration(v string) time.Duration {
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0
	}
	return d
}

func assembleDSN() string {
	get := func(k, def string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return def
	}
	dsn := "host=" + get("DB_HOST", "localhost") +
		" port=" + get("DB_PORT", "5432") +
		" user=" + get("DB_USER", "farm") +
		" password=" + get("DB_PASSWORD", "farm-dev-password") +
		" dbname=" + get("DB_NAME", "farmdb") +
		" sslmode=" + get("DB_SSLMODE", "disable")
	return dsn
}

// isURLForm reports whether dsn starts with postgres:// or postgresql://.
func isURLForm(dsn string) bool {
	u, err := url.Parse(dsn)
	return err == nil && (u.Scheme == "postgres" || u.Scheme == "postgresql")
}
