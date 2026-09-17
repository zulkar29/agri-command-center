package api

import (
	"crypto/subtle"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/farm-command/backend/internal/live"
	"github.com/farm-command/backend/internal/models"
	"github.com/farm-command/backend/internal/sensors"
)

// ingestTelemetryReq is the payload documented in docs/05-device-protocol.md
// (what an ESP32 node publishes to farm/<slug>/telemetry). Ts is Unix
// seconds; when omitted or zero the server stamps arrival time. A Ts more
// than maxClockSkew ahead of the server is refused: a reading "from the
// future" would stay the latest one and hide every real reading after it.
type ingestTelemetryReq struct {
	Farm         string    `json:"farm"`
	Node         string    `json:"node" binding:"required"`
	Ts           int64     `json:"ts"`
	SoilMoisture []float64 `json:"soil_moisture" binding:"required,min=1,dive,min=0,max=100"`
	AirTemp      float64   `json:"air_temp"`
	AirHumidity  float64   `json:"air_humidity"`
	TankLevel    float64   `json:"tank_level"`
	BatteryV     float64   `json:"battery_v"`
}

// maxClockSkew is how far ahead of the server clock a device's ts may run.
const maxClockSkew = 5 * time.Minute

// ingestTelemetry accepts one reading, stores it, and refreshes the farm's
// live state so the dashboard reflects the latest sensor values. Until the
// MQTT bridge exists, devices (or simulators) can POST here directly.
func (a *API) ingestTelemetry(c *gin.Context) {
	var req ingestTelemetryReq
	if err := c.ShouldBindJSON(&req); err != nil {
		badRequest(c, err)
		return
	}

	var farm models.Farm
	q := a.DB
	if req.Farm != "" {
		q = q.Where("slug = ?", req.Farm)
	}
	if err := q.First(&farm).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ফার্ম পাওয়া যায়নি: " + req.Farm})
		return
	}

	// per-device key: a device row with a key set must be unlocked with the
	// matching X-Device-Key header. With RequireDeviceKey (production) a node
	// that is unknown or has no key is refused too — the engine waters from
	// telemetry, so unauthenticated readings must never get through.
	var device models.Device
	found := a.DB.Where("farm_id = ? AND id = ?", farm.ID, req.Node).First(&device).Error == nil
	if !deviceAuthorized(found, device.ApiKey, c.GetHeader("X-Device-Key"), a.RequireDeviceKey) {
		c.Header("WWW-Authenticate", `DeviceKey header="X-Device-Key"`)
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "ডিভাইসের চাবি মেলেনি (X-Device-Key হেডার)।"})
		return
	}
	if err := sensors.Validate(req.AirTemp, req.AirHumidity, req.TankLevel, req.BatteryV); err != nil {
		badRequest(c, err)
		return
	}

	now := time.Now()
	ts := now
	if req.Ts > 0 {
		ts = time.Unix(req.Ts, 0)
		if ts.After(now.Add(maxClockSkew)) {
			badRequest(c, errInvalid("ts", "Unix seconds, not in the future (check the device clock)"))
			return
		}
	}
	row := models.Telemetry{
		FarmSlug: farm.Slug, Node: req.Node, Ts: ts,
		SoilMoisture: req.SoilMoisture,
		AirTemp:      req.AirTemp, AirHumidity: req.AirHumidity,
		TankLevel: req.TankLevel, BatteryV: req.BatteryV,
	}
	if err := a.DB.Create(&row).Error; err != nil {
		serverError(c, err)
		return
	}

	// refresh the farm's live state from this reading — one row: moist/valves
	// are per-zone arrays on the farm itself. Only the sensor columns are
	// written: a whole-row Save would race the engine and the pump/settings
	// handlers and could, say, switch the pump back to its earlier state.
	farm.Humidity = req.AirHumidity
	farm.Temp = req.AirTemp
	farm.Volt = req.BatteryV
	if req.TankLevel > 0 {
		farm.Tank = req.TankLevel
	}
	for i, m := range req.SoilMoisture {
		if i < len(farm.Moist) {
			farm.Moist[i] = math.Round(m*10) / 10
		}
	}
	if err := a.DB.Model(&farm).Select("humidity", "temp", "volt", "tank", "moist").Updates(&farm).Error; err != nil {
		serverError(c, err)
		return
	}

	// mark the sending node online
	if err := a.DB.Model(&models.Device{}).
		Where("farm_id = ? AND id = ?", farm.ID, req.Node).
		Updates(map[string]any{"online": true, "last_seen_at": now.UnixMilli()}).Error; err != nil {
		log.Printf("telemetry: marking %s online: %v", req.Node, err)
	}

	a.Live.Publish(farm.ID, live.EventTelemetry, row)
	a.Live.Touch(farm.ID, live.EventFarm)
	if found && !device.Online {
		a.Live.Touch(farm.ID, live.EventDevices) // came back online
	}

	c.JSON(http.StatusCreated, row)
}

// listTelemetry returns stored readings (oldest first, capped at 5000/page)
// for charts, wrapped in the standard Paged envelope.
// Query: ?hours=24 (default, max 720), ?node=esp32-field-1, ?page=&limit=
// (default limit 1000).
func (a *API) listTelemetry(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	hours, ok := queryHours(c)
	if !ok {
		return
	}
	p, ok := parsePaging(c, 1000, 5000)
	if !ok {
		return
	}

	since := time.Now().Add(-time.Duration(hours) * time.Hour)
	q := a.DB.Where("ts >= ? AND farm_slug = ?", since, farm.Slug)
	if node := c.Query("node"); node != "" {
		q = q.Where("node = ?", node)
	}

	var rows []models.Telemetry
	respondPaged(c, q, p, "ts", &rows)
}

// queryHours reads the ?hours= look-back window (default 24, max 720 = 30
// days) shared by the telemetry reads.
func queryHours(c *gin.Context) (int, bool) {
	v := c.Query("hours")
	if v == "" {
		return 24, true
	}
	hours, err := strconv.Atoi(v)
	if err != nil || hours < 1 || hours > 720 {
		badRequest(c, queryError{name: "hours", want: "1..720"})
		return 0, false
	}
	return hours, true
}

// bucketStrides are the ?bucket= sizes the chart endpoint accepts.
var bucketStrides = map[string]time.Duration{
	"5m": 5 * time.Minute, "15m": 15 * time.Minute,
	"1h": time.Hour, "6h": 6 * time.Hour, "1d": 24 * time.Hour,
}

// bucketOrigin aligns buckets to Bangladesh local time (UTC+6, no DST), so a
// "1d" bucket is a farm day from midnight, not a UTC day.
var bucketOrigin = time.Date(2000, 1, 1, 0, 0, 0, 0, models.FarmZone)

// telemetryBucket is one averaged time slice. TankLevel is null when no
// reading in the slice carried a tank level (0 = not reported, as in ingest).
type telemetryBucket struct {
	Ts           time.Time `json:"ts"`
	Count        int       `json:"count"`
	SoilMoisture []float64 `json:"soil_moisture" gorm:"-"`
	AirTemp      float64   `json:"air_temp"`
	AirHumidity  float64   `json:"air_humidity"`
	TankLevel    *float64  `json:"tank_level"`
	BatteryV     float64   `json:"battery_v"`
}

// listTelemetryBuckets returns readings averaged per time bucket (oldest
// first) — what the charts plot, without shipping every raw row. Readings
// from all nodes are averaged together unless ?node= narrows it; soil
// moisture is averaged per zone.
// Query: ?hours=24 (default, max 720), ?bucket=5m|15m|1h|6h|1d (default 1h),
// ?node=esp32-field-1.
//
// Uses PostgreSQL's date_bin rather than TimescaleDB's time_bucket so the
// endpoint (and its tests) also work on a plain PostgreSQL.
func (a *API) listTelemetryBuckets(c *gin.Context) {
	farm, ok := a.currentFarm(c)
	if !ok {
		return
	}
	hours, ok := queryHours(c)
	if !ok {
		return
	}
	bucket, ok := queryEnum(c, "bucket", "5m", "15m", "1h", "6h", "1d")
	if !ok {
		return
	}
	if bucket == "" {
		bucket = "1h"
	}
	stride := fmt.Sprintf("%d seconds", int(bucketStrides[bucket].Seconds()))

	where := "farm_slug = ? AND ts >= ?"
	args := []any{farm.Slug, time.Now().Add(-time.Duration(hours) * time.Hour)}
	if node := c.Query("node"); node != "" {
		where += " AND node = ?"
		args = append(args, node)
	}

	var buckets []telemetryBucket
	if err := a.DB.Raw(`SELECT date_bin(?::interval, ts, ?) AS ts, count(*) AS count,
			round(avg(air_temp)::numeric, 1)::float8 AS air_temp,
			round(avg(air_humidity)::numeric, 1)::float8 AS air_humidity,
			round(avg(nullif(tank_level, 0))::numeric, 1)::float8 AS tank_level,
			round(avg(battery_v)::numeric, 2)::float8 AS battery_v
		FROM telemetries WHERE `+where+`
		GROUP BY 1 ORDER BY 1`,
		append([]any{stride, bucketOrigin}, args...)...).Scan(&buckets).Error; err != nil {
		serverError(c, err)
		return
	}

	// soil_moisture is a JSON array per reading; unnest it with its 1-based
	// position to average each zone separately
	var zones []struct {
		Ts    time.Time
		Zone  int
		Moist float64
	}
	if err := a.DB.Raw(`SELECT date_bin(?::interval, ts, ?) AS ts, z.idx AS zone,
			round(avg(z.v::float8)::numeric, 1)::float8 AS moist
		FROM telemetries
		CROSS JOIN LATERAL jsonb_array_elements_text(soil_moisture::jsonb) WITH ORDINALITY AS z(v, idx)
		WHERE `+where+` AND jsonb_typeof(soil_moisture::jsonb) = 'array'
		GROUP BY 1, 2 ORDER BY 1, 2`,
		append([]any{stride, bucketOrigin}, args...)...).Scan(&zones).Error; err != nil {
		serverError(c, err)
		return
	}
	byTs := make(map[int64]*telemetryBucket, len(buckets))
	for i := range buckets {
		buckets[i].SoilMoisture = []float64{}
		byTs[buckets[i].Ts.UnixNano()] = &buckets[i]
	}
	for _, z := range zones { // ordered by zone, so append keeps positions
		if b := byTs[z.Ts.UnixNano()]; b != nil {
			b.SoilMoisture = append(b.SoilMoisture, z.Moist)
		}
	}

	if buckets == nil {
		buckets = []telemetryBucket{}
	}
	c.JSON(http.StatusOK, gin.H{"bucket": bucket, "items": buckets})
}

// deviceAuthorized decides whether a telemetry post may proceed. found says
// whether the node exists, key is its stored key, given the header value.
func deviceAuthorized(found bool, key, given string, require bool) bool {
	if !found || key == "" {
		return !require
	}
	return subtle.ConstantTimeCompare([]byte(key), []byte(given)) == 1
}
