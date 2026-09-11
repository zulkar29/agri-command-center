// Package testutil opens the integration-test database.
//
// Integration tests run against a real PostgreSQL named by TEST_DATABASE_URL
// and skip when it is unset. `go test ./...` runs packages in parallel, and
// each test wipes every table first — so each package gets its own schema
// (search_path) in that one database and they cannot trample each other.
package testutil

import (
	"net/url"
	"os"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/farm-command/backend/internal/models"
)

// OpenDB returns a migrated, emptied database handle scoped to schema, or
// skips the test when TEST_DATABASE_URL is not set.
func OpenDB(t *testing.T, schema string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	quiet := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}

	admin, err := gorm.Open(postgres.Open(dsn), quiet)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := admin.Exec(`CREATE SCHEMA IF NOT EXISTS ` + schema).Error; err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if sqlDB, err := admin.DB(); err == nil {
		sqlDB.Close()
	}

	db, err := gorm.Open(postgres.Open(withSearchPath(t, dsn, schema)), quiet)
	if err != nil {
		t.Fatalf("connect (schema %s): %v", schema, err)
	}
	if err := db.AutoMigrate(models.AllTables()...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, m := range models.AllTables() {
		if err := db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(m).Error; err != nil {
			t.Fatalf("wipe %T: %v", m, err)
		}
	}
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			sqlDB.Close()
		}
	})
	return db
}

// withSearchPath adds search_path to a postgres:// URL DSN.
func withSearchPath(t *testing.T, dsn, schema string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		t.Fatalf("TEST_DATABASE_URL must be a postgres:// URL, got %q", dsn)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String()
}
