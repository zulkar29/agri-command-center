// Farm Command API server.
//
// Serves the REST API under /api (called by the dashboard's src/services/
// and future MQTT bridge) and, when STATIC_DIR points at a built dashboard,
// the SPA itself on the same port — one binary, one port, no nginx.
package main

import (
	"context"
	"log"
	"time"

	"github.com/farm-command/backend/internal/alerts"
	"github.com/farm-command/backend/internal/api"
	"github.com/farm-command/backend/internal/config"
	"github.com/farm-command/backend/internal/db"
	"github.com/farm-command/backend/internal/engine"
	"github.com/farm-command/backend/internal/live"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/notify"
	"github.com/farm-command/backend/internal/report"
	"github.com/farm-command/backend/internal/weather"
)

func main() {
	cfg := config.Load()

	// production hard requirements — fail fast instead of running unsafe
	if cfg.Env == "production" && cfg.JWTSecret == "" {
		log.Fatal("ENV=production কিন্তু JWT_SECRET দেওয়া নেই — একটা লম্বা র‍্যান্ডম স্ট্রিং দিন (openssl rand -hex 32)")
	}

	// the demo seed ships public passwords and device keys
	if cfg.Env == "production" && cfg.SeedDemoData {
		log.Fatal("ENV=production কিন্তু SEED_DEMO_DATA চালু — ডেমো পাসওয়ার্ড ও ডিভাইস চাবি সবার জানা। SEED_DEMO_DATA=false দিন")
	}

	gdb := db.Open(cfg.DSN)
	db.SetupTimescale(gdb, cfg.TelemetryRetentionDays)
	if cfg.SeedDemoData {
		db.SeedIfEmpty(gdb)
	}

	if cfg.JWTSecret == "" {
		log.Printf("JWT_SECRET not set — using a random secret for this boot (set it to keep access tokens across restarts)")
	}
	if cfg.GoogleClientID == "" {
		log.Printf("GOOGLE_CLIENT_ID not set — Google login is disabled")
	}

	// Weather (Open-Meteo) feeds GET /api/v1/weather and the engine's r1
	// rain-skip rule; one cache serves both.
	wx := weather.New()

	// Alerts ride the engine's tick: evaluated server-side after each farm's
	// step and pushed on activation, together with the Friday weekly summary,
	// over whichever channels are configured (Telegram, SMS gateway).
	router := &notify.Router{DB: gdb, FarmChat: cfg.TelegramChatID}
	if cfg.TelegramBotToken != "" {
		router.Telegram = &notify.Telegram{BotToken: cfg.TelegramBotToken}
	}
	if cfg.SMSGatewayURL != "" {
		router.SMS = &notify.SMS{URL: cfg.SMSGatewayURL, Token: cfg.SMSGatewayToken}
	}
	var alertNotifier alerts.Notifier
	var send func(*models.Farm, string)
	if router.Enabled() {
		alertNotifier, send = router.Alert, router.Text
	} else {
		log.Printf("no Telegram/SMS configured — alerts stay in the app")
	}

	// Irrigation automation (auto mode, Duration stop, schedules, rules r1/r2)
	// and alert evaluation run server-side so they hold with no client
	// connected. The clients stop their own demo tick while connected here.
	// Live fans every change out to open dashboard streams (GET
	// /api/v1/stream): the engine's ticks here, API writes and telemetry in
	// the router.
	hub := live.New()

	eng := engine.New(gdb, cfg.EngineInterval)
	eng.Weather = wx
	pumpWas := map[string]bool{} // per farm, to tell streams when the engine switched the relay
	eng.EvalAlerts = func(farm *models.Farm, now time.Time) {
		changed := alerts.EvalFarm(gdb, farm, alertNotifier, now)
		report.MaybeSend(gdb, farm, now, send)
		hub.Touch(farm.ID, live.EventFarm) // sensors drift, the pump may switch
		if was, seen := pumpWas[farm.ID]; seen && was != farm.PumpOn {
			hub.Touch(farm.ID, live.EventDevices)
		}
		pumpWas[farm.ID] = farm.PumpOn
		if changed {
			hub.Touch(farm.ID, live.EventAlerts)
		}
	}
	go eng.Start(context.Background())

	r := api.NewRouter(gdb, cfg.StaticDir, api.AuthOptions{
		JWTSecret:        []byte(cfg.JWTSecret),
		GoogleClientID:   cfg.GoogleClientID,
		RequireDeviceKey: cfg.RequireDeviceKey,
		CORSOrigins:      cfg.CORSOrigins,
	}, wx, hub)
	log.Printf("farm-command API listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
