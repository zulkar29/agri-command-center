package db

import (
	"fmt"
	"log"

	"gorm.io/gorm"
)

// compressAfterDays is when telemetry chunks get compressed. Readings that old
// are only charted, never edited; compression cuts their disk use ~10x and
// keeps them queryable (late readings still insert into compressed chunks).
const compressAfterDays = 7

// SetupTimescale turns the telemetries table into a TimescaleDB hypertable
// partitioned on ts, compresses chunks older than a week and applies the
// retention policy (retentionDays 0 = keep everything). Safe to run on every
// boot. Without the extension (a plain PostgreSQL) it logs and returns: the
// table works as before, just without compression or retention.
func SetupTimescale(gdb *gorm.DB, retentionDays int) {
	// GORM's single-column indexes from before the (farm_slug, ts) index;
	// AutoMigrate never drops indexes on its own
	for _, idx := range []string{"idx_telemetries_farm_slug", "idx_telemetries_ts"} {
		if err := gdb.Exec("DROP INDEX IF EXISTS " + idx).Error; err != nil {
			log.Printf("timescale: dropping legacy index %s: %v", idx, err)
		}
	}

	if err := gdb.Exec("CREATE EXTENSION IF NOT EXISTS timescaledb").Error; err != nil {
		log.Printf("TimescaleDB unavailable — telemetry stays a plain table (no compression/retention): %v", err)
		return
	}

	var isHypertable bool
	if err := gdb.Raw(`SELECT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
		WHERE hypertable_name = 'telemetries')`).Scan(&isHypertable).Error; err != nil {
		log.Fatalf("timescale: checking hypertable: %v", err)
	}
	if !isHypertable {
		if err := gdb.Transaction(func(tx *gorm.DB) error {
			// unique keys on a hypertable must include the time column; tables
			// created before the switch have a PRIMARY KEY (id) only
			if err := tx.Exec(`ALTER TABLE telemetries DROP CONSTRAINT IF EXISTS telemetries_pkey,
				ADD PRIMARY KEY (id, ts)`).Error; err != nil {
				return fmt.Errorf("widening primary key: %w", err)
			}
			if err := tx.Exec(`SELECT create_hypertable('telemetries', by_range('ts'),
				migrate_data => true)`).Error; err != nil {
				return fmt.Errorf("create_hypertable: %w", err)
			}
			// segment by sender so one farm's/node's chart reads one segment
			return tx.Exec(`ALTER TABLE telemetries SET (timescaledb.compress,
				timescaledb.compress_segmentby = 'farm_slug, node',
				timescaledb.compress_orderby = 'ts DESC, id')`).Error
		}); err != nil {
			log.Fatalf("timescale: converting telemetries to a hypertable: %v", err)
		}
		log.Printf("timescale: telemetries is now a hypertable")
	}

	if err := gdb.Exec(fmt.Sprintf(`SELECT add_compression_policy('telemetries',
		INTERVAL '%d days', if_not_exists => true)`, compressAfterDays)).Error; err != nil {
		log.Fatalf("timescale: compression policy: %v", err)
	}

	// drop-and-add so a changed TELEMETRY_RETENTION_DAYS takes effect on restart
	if err := gdb.Exec(`SELECT remove_retention_policy('telemetries', if_exists => true)`).Error; err != nil {
		log.Fatalf("timescale: clearing retention policy: %v", err)
	}
	if retentionDays > 0 {
		if err := gdb.Exec(fmt.Sprintf(`SELECT add_retention_policy('telemetries',
			INTERVAL '%d days')`, retentionDays)).Error; err != nil {
			log.Fatalf("timescale: retention policy: %v", err)
		}
		log.Printf("timescale: telemetry older than %d days is dropped", retentionDays)
	}
}
