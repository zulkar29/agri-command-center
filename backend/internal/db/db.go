// Package db opens the PostgreSQL connection, migrates the schema and seeds
// demo data on first boot.
package db

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/farm-command/backend/internal/models"
)

// Open connects to PostgreSQL with retries (the container may still be
// starting when the API boots), then auto-migrates the schema.
func Open(dsn string) *gorm.DB {
	var gdb *gorm.DB
	var err error
	for attempt := 1; attempt <= 12; attempt++ {
		gdb, err = gorm.Open(postgres.Open(dsn), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Warn),
		})
		if err == nil {
			break
		}
		log.Printf("waiting for database (%d/12): %v", attempt, err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatalf("cannot reach database: %v", err)
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		log.Fatalf("underlying sql.DB unavailable: %v", err)
	}
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(time.Hour)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := gdb.WithContext(ctx).AutoMigrate(models.AllTables()...); err != nil {
		log.Fatalf("auto-migrate failed: %v", err)
	}
	// Zones moved inline into farms (Farm.Moist/Valves). If an earlier deploy
	// created the table, fold each farm's zone rows into its arrays and drop
	// it — no manual reset needed.
	if gdb.Migrator().HasTable("zones") {
		migrateLegacyZones(gdb)
		if err := gdb.Migrator().DropTable("zones"); err != nil {
			log.Printf("dropping legacy zones table: %v", err)
		}
	}

	return gdb
}

// legacyZone matches the pre-collapse zones table for the one-time transfer.
type legacyZone struct {
	FarmID    string
	Idx       int
	Moisture  float64
	ValveOpen bool
}

func (legacyZone) TableName() string { return "zones" }

func migrateLegacyZones(gdb *gorm.DB) {
	var farms []models.Farm
	if err := gdb.Find(&farms).Error; err != nil {
		log.Printf("legacy zones: loading farms: %v", err)
		return
	}
	for _, f := range farms {
		if len(f.Moist) > 0 {
			continue
		}
		var zones []legacyZone
		if err := gdb.Where("farm_id = ?", f.ID).Order("idx").Find(&zones).Error; err != nil || len(zones) == 0 {
			continue
		}
		moist := make([]float64, len(zones))
		valves := make([]bool, len(zones))
		for i, z := range zones {
			moist[i], valves[i] = z.Moisture, z.ValveOpen
		}
		f.Moist, f.Valves = moist, valves
		if err := gdb.Save(&f).Error; err != nil {
			log.Printf("legacy zones: migrating farm %s: %v", f.ID, err)
		}
	}
}

// SeedIfEmpty inserts the demo dataset when the farms table has no rows.
func SeedIfEmpty(gdb *gorm.DB) {
	// the demo login is seeded even when farm data already exists, so an
	// older volume gains login without a reset
	seedDemoUser(gdb)

	var count int64
	if err := gdb.Model(&models.Farm{}).Count(&count).Error; err != nil {
		log.Fatalf("cannot count farms: %v", err)
	}
	if count > 0 {
		return
	}

	if err := gdb.Transaction(func(tx *gorm.DB) error {
		for _, m := range seedModels() {
			if err := tx.Create(m).Error; err != nil {
				return fmt.Errorf("seeding %T: %w", m, err)
			}
		}
		// Bulk insert generated telemetry history (a few hundred rows).
		return tx.Create(&telemetryHistory).Error
	}); err != nil {
		log.Fatalf("seeding demo data failed: %v", err)
	}
	log.Printf("seeded demo data: farm %q with %d telemetry readings", farmSlug, len(telemetryHistory))
}

// seedDemoUser creates the three demo accounts (one per role) the login
// screens hint at, each only when its email is missing — so an older volume
// gains them on upgrade and hand-created accounts are never touched.
func seedDemoUser(gdb *gorm.DB) {
	hash, err := bcrypt.GenerateFromPassword([]byte(DemoPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("hashing demo password: %v", err)
	}
	demo := []models.User{
		{Name: "আপনি", Email: DemoEmail, Role: models.RoleOwner},
		{Name: "বাবা", Email: DemoOperatorEmail, Role: models.RoleOperator},
		{Name: "মেহমান", Email: DemoViewerEmail, Role: models.RoleViewer},
	}
	for _, user := range demo {
		var count int64
		if err := gdb.Model(&models.User{}).Where("lower(email) = ?", strings.ToLower(user.Email)).Count(&count).Error; err != nil {
			log.Fatalf("cannot count users: %v", err)
		}
		if count > 0 {
			continue
		}
		user.PasswordHash = string(hash)
		if err := gdb.Create(&user).Error; err != nil {
			log.Fatalf("seeding demo user %s: %v", user.Email, err)
		}
		log.Printf("seeded demo user %q (%s, password %q)", user.Email, user.Role, DemoPassword)
	}
}
