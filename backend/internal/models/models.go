// Package models defines the database schema. JSON tags intentionally match
// the dashboard's TypeScript types (src/types.ts) so the frontend can adopt
// this API without a translation layer.
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/farm-command/backend/internal/bangla"
)

// FarmZone is Bangladesh local time (UTC+6, no DST): day boundaries, the
// daily pump limit, task deadlines and the weekly summary all use it.
var FarmZone = time.FixedZone("Asia/Dhaka", 6*60*60)

// shortID returns an 8-char id, same shape as the frontend's crypto.randomUUID().slice(0, 8).
func shortID() string {
	return uuid.NewString()[:8]
}

// assignIDIfEmpty assigns a readable short id when none was supplied; called
// from BeforeCreate hooks so seeds can keep their stable ids.
func assignIDIfEmpty(id *string) {
	if *id == "" {
		*id = shortID()
	}
}

type Farm struct {
	ID string `gorm:"primaryKey;size:40" json:"id"`
	// Slug is used in device-protocol topics, e.g. farm/<slug>/telemetry (docs/05).
	Slug      string `gorm:"uniqueIndex;size:60" json:"slug"`
	Name      string `json:"farmName"`
	Simulate  bool   `json:"simulate"`
	Mode      string `json:"mode"` // 'auto' | 'manual'
	PumpOn    bool   `json:"pumpOn"`
	Threshold int    `json:"threshold"`
	Duration  int    `json:"duration"` // minutes
	// PumpSince is when the current pump-on stretch began — set by the
	// irrigation engine (internal/engine) so it can stop auto watering after
	// Duration minutes. Cleared when the pump stops or someone drives the
	// pump by hand. Engine-only bookkeeping, hence hidden from clients.
	PumpSince *time.Time `json:"-"`
	// Moist/Valves are per-zone soil moisture % and valve states; the array
	// length IS the zone count (3 in the demo — ZoneNames below labels them).
	// Kept inline rather than a zones table: every client (dashboard, mobile,
	// telemetry payload) treats them as plain arrays, so a table only added a
	// rows→arrays mapping on every read and write.
	Moist    []float64     `gorm:"serializer:json" json:"moist"`
	Valves   []bool        `gorm:"serializer:json" json:"valves"`
	Tank     float64       `json:"tank"`
	Humidity float64       `json:"humidity"`
	Temp     float64       `json:"temp"`
	Volt     float64       `json:"volt"`
	Notif    NotifSettings `gorm:"serializer:json" json:"notif"`
	// Location for the weather service (Open-Meteo) and the
	// r1 "skip watering when rain is likely" rule. Optional — unset farms
	// keep the sample forecast. Sent as null (not omitted) when unset: the
	// clients merge each snapshot over their store, so a missing key would
	// leave a stale value behind.
	Lat *float64 `json:"lat"`
	Lng *float64 `json:"lng"`
	// PumpFlowLpm is the pump's measured flow in litres per minute (owner
	// sets it after the bucket test). 0 = unknown: runs are recorded but
	// litres stay 0 (internal/water).
	PumpFlowLpm float64 `json:"pumpFlowLpm"`
	// MaxDailyMinutes caps the pump's total run time per day (Asia/Dhaka);
	// auto mode will not start past it and stops a running auto stretch. A
	// safety net against a stuck sensor or a bad rule draining the tank.
	// 0 = no limit. Owner-only.
	MaxDailyMinutes int `json:"maxDailyMinutes"`
	// DigestAt is when the weekly summary was last sent (engine bookkeeping).
	DigestAt *time.Time `json:"-"`
}

// ZoneNames labels the per-zone arrays (moist/valves) — index is the zone
// index, matching the seed and the clients' zone chips. Shared by api (log
// lines) and the irrigation engine (schedule zones).
var ZoneNames = []string{"জোন ক", "জোন খ", "জোন গ"}

// ZoneLabel names zone idx: its ZoneNames entry, else "জোন <n>" (1-based).
func ZoneLabel(idx int) string {
	if idx >= 0 && idx < len(ZoneNames) {
		return ZoneNames[idx]
	}
	return "জোন " + bangla.Num(idx+1)
}

func (f *Farm) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&f.ID)
	return nil
}

// Rule kinds the engine understands. A rule with another (or empty) kind is
// a note the engine does not act on yet.
const (
	RuleRainSkip  = "rain-skip"  // skip watering when tomorrow's rain is likely
	RuleTankGuard = "tank-guard" // stop/never start the pump on a low tank
)

type Rule struct {
	ID     string `gorm:"primaryKey;size:40" json:"id"`
	FarmID string `gorm:"index;size:40" json:"-"`
	Text   string `json:"text"`
	On     bool   `json:"on"`
	// Kind says which engine behaviour this rule switches (Rule* above).
	Kind      string    `gorm:"size:30" json:"kind"`
	CreatedAt time.Time `json:"-"`
}

func (r *Rule) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&r.ID)
	return nil
}

type Schedule struct {
	ID     string `gorm:"primaryKey;size:40" json:"id"`
	FarmID string `gorm:"index;size:40" json:"-"`
	Time   string `json:"time"` // 24-hour "HH:MM"
	Dur    int    `json:"dur"`  // minutes
	Zone   string `json:"zone"`
	On     bool   `json:"on"`
	// LastRun is the day the engine last fired this schedule — engine-only
	// bookkeeping so a 07:00 schedule runs once, not on every tick within
	// 07:00. Hidden from clients.
	LastRun   *time.Time `json:"-"`
	CreatedAt time.Time  `json:"-"`
}

func (s *Schedule) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&s.ID)
	return nil
}

// LogEntry is an irrigation log line; At is epoch milliseconds.
type LogEntry struct {
	ID        string    `gorm:"primaryKey;size:40" json:"id"`
	FarmID    string    `gorm:"index;size:40" json:"-"`
	At        int64     `json:"at"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"-"`
}

func (l *LogEntry) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&l.ID)
	return nil
}

type Field struct {
	ID        string  `gorm:"primaryKey;size:40" json:"id"`
	FarmID    string  `gorm:"index;size:40" json:"-"`
	Name      string  `json:"name"`
	Crop      string  `json:"crop"`
	Area      float64 `json:"area"` // শতক
	Plants    int     `json:"plants"`
	Age       int     `json:"age"` // days since planting
	HarvestAt int     `json:"harvestAt"`
	// Zone is the index into the farm's moist/valves arrays that waters
	// this field (nil = unlinked); it lets pump water be attributed to a
	// field for the litres-per-kg figure.
	Zone      *int      `json:"zone,omitempty"`
	CreatedAt time.Time `json:"-"`
}

func (f *Field) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&f.ID)
	return nil
}

// Observation is a scouting note; At is epoch milliseconds.
type Observation struct {
	ID     string `gorm:"primaryKey;size:40" json:"id"`
	FarmID string `gorm:"index;size:40" json:"-"`
	At     int64  `json:"at"`
	Kind   string `json:"kind"` // 'ঠিক আছে' | 'পোকা' | 'রোগ'
	Note   string `json:"note"`
	// FieldID optionally ties the note to a field (history for next-crop advice).
	FieldID   string    `gorm:"index;size:40" json:"fieldId,omitempty"`
	CreatedAt time.Time `json:"-"`
}

func (o *Observation) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&o.ID)
	return nil
}

type Task struct {
	ID     string `gorm:"primaryKey;size:40" json:"id"`
	FarmID string `gorm:"index;size:40" json:"-"`
	Text   string `json:"text"`
	Who    string `json:"who"`
	Due    string `json:"due"` // 'আজ' | 'কাল' | 'এই সপ্তাহ' — the coarse label
	Urgent bool   `json:"urgent"`
	Done   bool   `json:"done"`
	// DueAt is the exact deadline (epoch ms, 0 = none); when set it wins over
	// the label, drives the overdue alert and is what repeating tasks advance.
	DueAt int64 `json:"dueAt"`
	// RepeatDays > 0 makes the task recur: completing it creates the next one
	// that many days later (e.g. a spray every 10 days).
	RepeatDays int `json:"repeatDays"`
	// FieldID optionally ties the task to a field.
	FieldID   string    `gorm:"size:40" json:"fieldId,omitempty"`
	CreatedAt time.Time `json:"-"`
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&t.ID)
	return nil
}

// LedgerEntry is an income/expense row; At is epoch milliseconds.
type LedgerEntry struct {
	ID     string  `gorm:"primaryKey;size:40" json:"id"`
	FarmID string  `gorm:"index;size:40" json:"-"`
	At     int64   `json:"at"`
	Type   string  `json:"type"` // 'income' | 'expense'
	Cat    string  `json:"cat"`
	Amount float64 `json:"amount"`
	Note   string  `json:"note"`
	// FieldID optionally tags the entry to a field (profit per crop).
	FieldID   string    `gorm:"index;size:40" json:"fieldId,omitempty"`
	CreatedAt time.Time `json:"-"`
}

func (l *LedgerEntry) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&l.ID)
	return nil
}

type StockItem struct {
	ID        string    `gorm:"primaryKey;size:40" json:"id"`
	FarmID    string    `gorm:"index;size:40" json:"-"`
	Name      string    `json:"name"`
	Unit      string    `json:"unit"`
	Qty       float64   `json:"qty"`
	Min       float64   `json:"min"`
	CreatedAt time.Time `json:"-"`
}

// IsLow is the shared "needs buying" test: a minimum is set and the stock is
// at or below it. The low-stock alert and GET /stock?low=true both use it.
func (s StockItem) IsLow() bool { return s.Min > 0 && s.Qty <= s.Min }

func (s *StockItem) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&s.ID)
	return nil
}

type TeamMember struct {
	ID        string    `gorm:"primaryKey;size:40" json:"id"`
	FarmID    string    `gorm:"index;size:40" json:"-"`
	Name      string    `json:"name"`
	Role      string    `json:"role"` // 'মালিক' | 'অপারেটর' | 'দর্শক'
	CreatedAt time.Time `json:"-"`
}

func (t *TeamMember) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&t.ID)
	return nil
}

// Roles — the same Bengali labels the team list shows. Write permissions per
// role are enforced in api/router.go (owner ⊃ operator; viewer is read-only).
const (
	RoleOwner    = "মালিক"
	RoleOperator = "অপারেটর"
	RoleViewer   = "দর্শক"
)

// User is a person who may log in to the dashboard or mobile app.
type User struct {
	ID           string `gorm:"primaryKey;size:40" json:"id"`
	Name         string `json:"name"`
	Email        string `gorm:"uniqueIndex;size:120" json:"email"`
	PasswordHash string `gorm:"size:100" json:"-"`
	Role         string `json:"role"`
	// Phone (SMS) and TelegramChat are where this person receives alerts and
	// the weekly summary; empty = that channel is off for them.
	Phone        string    `gorm:"size:20" json:"phone"`
	TelegramChat string    `gorm:"size:30" json:"telegramChat"`
	CreatedAt    time.Time `json:"-"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&u.ID)
	return nil
}

// Session is one logged-in client: its random refresh token with an expiry
// (the bearer access token is a stateless JWT, api/jwt.go).
type Session struct {
	Token     string    `gorm:"primaryKey;size:64" json:"-"`
	UserID    string    `gorm:"index;size:40" json:"-"`
	User      User      `gorm:"constraint:OnDelete:CASCADE" json:"-"`
	ExpiresAt time.Time `json:"-"`
}

// Device mirrors the DeviceStatus shape used by src/services/devices.ts.
type Device struct {
	ID         string             `gorm:"primaryKey;size:60" json:"id"`
	FarmID     string             `gorm:"index;size:40" json:"-"`
	Kind       string             `json:"kind"` // 'sensor' | 'relay' | 'gateway'
	Online     bool               `json:"online"`
	Metrics    map[string]float64 `gorm:"serializer:json" json:"metrics"`
	LastSeenAt int64              `json:"lastSeenAt"` // epoch ms
	// ApiKey gates POST /api/v1/telemetry for this node (X-Device-Key header).
	// Empty = open, so existing deployments keep working until keys are set;
	// owners reveal it via GET /api/v1/devices/:id/key.
	ApiKey string `gorm:"size:64" json:"-"`
}

// AfterFind keeps metrics an object on the wire: a row stored without any
// (NULL column) would otherwise marshal as null, and both clients read
// metrics.<key> / Object.keys(metrics) unguarded.
func (d *Device) AfterFind(tx *gorm.DB) error {
	if d.Metrics == nil {
		d.Metrics = map[string]float64{}
	}
	return nil
}

// Alert is one server-side warning. Kind is a stable slug
// (dry0..2, tank, battery, hum, stock-<id>, offline-<id>) used to match a
// live condition to its row across ticks — that is the "don't re-notify"
// memory. Server text stays Bengali, like log lines and error messages.
type Alert struct {
	ID      string `gorm:"primaryKey;size:40" json:"id"`
	FarmID  string `gorm:"index;size:40" json:"-"`
	Kind    string `gorm:"index;size:60" json:"kind"`
	Title   string `json:"title"`
	Detail  string `json:"detail"`
	Tone    string `json:"tone"` // 'bad' | 'warn'
	Active  bool   `json:"active"`
	Ack     bool   `json:"ack"`
	FirstAt int64  `json:"firstAt"` // epoch ms
	LastAt  int64  `json:"lastAt"`
}

func (a *Alert) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&a.ID)
	return nil
}

// AuditLog records who did what when — pump commands,
// writes and deletes, user administration.
type AuditLog struct {
	ID       string `gorm:"primaryKey;size:40" json:"id"`
	FarmID   string `gorm:"index;size:40" json:"-"`
	UserID   string `gorm:"index;size:40" json:"-"`
	UserName string `json:"user"`
	Action   string `json:"action"` // e.g. 'pump.on', 'ledger.delete'
	Detail   string `json:"detail"`
	At       int64  `json:"at"` // epoch ms
}

func (l *AuditLog) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&l.ID)
	return nil
}

// Telemetry rows follow the payload documented in docs/05-device-protocol.md.
// The table is a TimescaleDB hypertable on Ts (db.SetupTimescale), which is
// why Ts is part of the primary key: hypertable unique keys must include the
// time column. Charts filter by farm and time, hence the (farm_slug, ts) index.
type Telemetry struct {
	ID           uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	FarmSlug     string    `gorm:"index:idx_telemetries_farm_ts,priority:1;size:60" json:"farm"`
	Node         string    `gorm:"index;size:60" json:"node"`
	Ts           time.Time `gorm:"primaryKey;index:idx_telemetries_farm_ts,priority:2" json:"ts"`
	SoilMoisture []float64 `gorm:"serializer:json" json:"soil_moisture"`
	AirTemp      float64   `json:"air_temp"`
	AirHumidity  float64   `json:"air_humidity"`
	TankLevel    float64   `json:"tank_level"`
	BatteryV     float64   `json:"battery_v"`
}

type NotifSettings struct {
	Push     bool `json:"push"`
	Sms      bool `json:"sms"`
	Whatsapp bool `json:"whatsapp"`
	Telegram bool `json:"telegram"`
}

// Harvest is one picking from a field; At is epoch milliseconds. PricePerKg
// is what it sold for (0 = not sold/unknown).
type Harvest struct {
	ID         string    `gorm:"primaryKey;size:40" json:"id"`
	FarmID     string    `gorm:"index;size:40" json:"-"`
	FieldID    string    `gorm:"index;size:40" json:"fieldId"`
	At         int64     `gorm:"index" json:"at"`
	Kg         float64   `json:"kg"`
	Grade      string    `json:"grade"`
	PricePerKg float64   `json:"pricePerKg"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"-"`
}

func (h *Harvest) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&h.ID)
	return nil
}

// PumpRun is one stretch of water use. Start/End are epoch ms (End 0 = still
// running); Zones are the zone indexes that were open and share the litres
// equally. Source is 'pump' (relay on→off) | 'manual' | 'schedule'
// (fixed-minute waterings with no relay trace).
type PumpRun struct {
	ID     string  `gorm:"primaryKey;size:40" json:"id"`
	FarmID string  `gorm:"index;size:40" json:"-"`
	Start  int64   `gorm:"index" json:"start"`
	End    int64   `json:"end"`
	Zones  []int   `gorm:"serializer:json" json:"zones"`
	Litres float64 `json:"litres"`
	Source string  `json:"source"`
}

func (r *PumpRun) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&r.ID)
	return nil
}

// MarketPrice is one price the owner noted for a crop (per kg); At is epoch
// milliseconds. Feeds the next-crop recommendation until an official source
// exists.
type MarketPrice struct {
	ID         string    `gorm:"primaryKey;size:40" json:"id"`
	FarmID     string    `gorm:"index;size:40" json:"-"`
	Crop       string    `gorm:"index" json:"crop"`
	At         int64     `gorm:"index" json:"at"`
	PricePerKg float64   `json:"pricePerKg"`
	Market     string    `json:"market"`
	CreatedAt  time.Time `json:"-"`
}

func (m *MarketPrice) BeforeCreate(tx *gorm.DB) error {
	assignIDIfEmpty(&m.ID)
	return nil
}

// AllTables lists every model in migration order.
func AllTables() []any {
	return []any{
		&User{}, &Session{},
		&Farm{}, &Rule{}, &Schedule{}, &LogEntry{},
		&Field{}, &Observation{}, &Task{}, &LedgerEntry{},
		&StockItem{}, &TeamMember{}, &Device{}, &Telemetry{},
		&Alert{}, &AuditLog{}, &Harvest{}, &PumpRun{}, &MarketPrice{},
	}
}
