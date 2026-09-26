export type ViewId =
  | 'overview'
  | 'irrigation'
  | 'fields'
  | 'analytics'
  | 'tasks'
  | 'finance'
  | 'reports'
  | 'inventory'
  | 'devices'
  | 'settings'

export type Mode = 'auto' | 'manual'
export type ObsKind = 'ঠিক আছে' | 'পোকা' | 'রোগ'
export type Due = 'আজ' | 'কাল' | 'এই সপ্তাহ' | 'পরে'
export type Assignee = 'বাবা' | 'আমি' | 'শ্রমিক'
export type Role = 'মালিক' | 'অপারেটর' | 'দর্শক'

/** The logged-in account, as returned by POST /api/v1/auth/login / GET /api/v1/auth/me. */
export interface AuthUser {
  id: string
  name: string
  email: string
  role: Role
  /** where this person's SMS alerts go ('' = off) */
  phone?: string
  /** where this person's Telegram alerts go ('' = off) */
  telegramChat?: string
}

/** What login/refresh/Google resolve to: the short-lived JWT access token
 *  (http.ts sends it as the bearer header), the rotating refresh token and
 *  the user. */
export interface AuthSession {
  token: string
  refreshToken: string
  user: AuthUser
}

export interface Rule {
  id: string
  text: string
  on: boolean
  /** what the engine does with it: 'rain-skip' | 'tank-guard' | '' (a note only) */
  kind?: string
}

export interface Schedule {
  id: string
  /** 24-hour "HH:MM", ASCII digits */
  time: string
  /** minutes */
  dur: number
  zone: string
  on: boolean
}

export interface LogEntry {
  id: string
  /** epoch ms */
  at: number
  text: string
}

export interface Field {
  id: string
  name: string
  crop: string
  /** শতক */
  area: number
  plants: number
  /** days since planting */
  age: number
  /** day count after which harvesting starts (set by the farmer, varies by variety) */
  harvestAt: number
  /** watering zone index that irrigates this field (links pump water to it) */
  zone?: number
}

export interface Observation {
  id: string
  at: number
  kind: ObsKind
  note: string
  fieldId?: string
}

export interface Task {
  id: string
  text: string
  /** one of the form's assignees, or any name — the server stores free text
   *  (crop-template tasks carry the planting user's name) */
  who: Assignee | (string & {})
  /** coarse label; derived from dueAt by the server when a deadline is given */
  due: Due
  urgent: boolean
  done: boolean
  /** exact deadline, epoch ms (0/absent = none) */
  dueAt?: number
  /** > 0: completing it creates the next one this many days later */
  repeatDays?: number
  fieldId?: string
}

export interface LedgerEntry {
  id: string
  at: number
  type: 'income' | 'expense'
  cat: string
  amount: number
  note: string
  /** field the entry belongs to (profit per field) */
  fieldId?: string
}

export interface StockItem {
  id: string
  name: string
  unit: string
  qty: number
  min: number
}

export interface NotifSettings {
  push: boolean
  sms: boolean
  whatsapp: boolean
  telegram: boolean
}

export interface TeamMember {
  id: string
  name: string
  role: Role
}

/** Everything the app persists and renders. Actions live in the store. */
export interface FarmData {
  farmName: string
  /** the server's farm id in device payloads and MQTT topics; absent in demo data */
  slug?: string
  /** demo simulation: sensors drift and the pump logic runs */
  simulate: boolean
  mode: Mode
  pumpOn: boolean
  /** auto irrigation starts when a zone drops below this % */
  threshold: number
  /** minutes */
  duration: number
  /** soil moisture % per zone (floats while simulating) */
  moist: number[]
  valves: boolean[]
  /** tank level % */
  tank: number
  humidity: number
  temp: number
  volt: number
  ack: Record<string, boolean>
  rules: Rule[]
  schedules: Schedule[]
  irrLog: LogEntry[]
  fields: Field[]
  scout: Observation[]
  tasks: Task[]
  ledger: LedgerEntry[]
  stock: StockItem[]
  notif: NotifSettings
  team: TeamMember[]
  /** optional location for the weather service (owner sets it in settings);
   *  the server sends null while unset */
  lat?: number | null
  lng?: number | null
  /** auto mode stops starting the pump after this many minutes a day (0 = no limit) */
  maxDailyMinutes?: number
}

/**
 * GET /api/v1/farm's payload: the control snapshot only. Collections with their
 * own REST endpoints (schedules, fields, scout, tasks, ledger, stock) are not
 * embedded — list them through src/services/. `hydrate` merges this over the
 * store, so the demo lists simply survive a live snapshot.
 */
export type FarmSnapshot = Omit<
  FarmData,
  'schedules' | 'fields' | 'scout' | 'tasks' | 'ledger' | 'stock' | 'ack'
>

/** Standard envelope every list endpoint returns (backend paging.go). */
export interface Page<T> {
  items: T[]
  total: number
  page: number
  limit: number
  pages: number
}
