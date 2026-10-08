# 9. REST API reference

Source of truth: [`backend/internal/api/router.go`](../backend/internal/api/router.go)
(the route table) — this page explains the conventions behind it.
`routes_test.go` enforces the parts that can be checked without a database.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` (only `GET /api/health` is unversioned). The prefix is one constant (`api.APIBase`, and `API_PREFIX` in each client's `services/http.ts`); services use paths relative to it. Breaking changes go to `/api/v2`. Plural kebab-case nouns for collections (`/pump-runs`), singular for singletons (`/farm`, `/farm/pump`). |
| Verbs | None in paths except `/auth/*`. Things the farm does are collections that get a new row: `POST /farm/waterings`, `POST /farm/tank-fills` (→ `201` + the refreshed `/farm` snapshot), `POST /devices/:id/commands` (→ `201` + the relay row). |
| Collections | `GET` answers `{items,total,page,limit,pages}`; query `?q=&page=&limit=` plus filters. `limit` defaults to 50 (max 200; raw `/telemetry` defaults to 1000, max 5000). Ordering is fixed per resource with `id` as tie-break, so pages never overlap. `q` is a case-insensitive substring match (`%` and `_` are literal). Time bounds are `from`/`to` in epoch ms. |
| Create | `POST` → `201` + the new row (also for `POST /devices/:id/key`, which mints a key). Tasks, ledger entries and observations also take an optional client `id` (6–40 letters/digits/dashes) and, for the last two, `at` (epoch ms, within the last 90 days): a repeat of the same `id` is `409`, which is how the mobile app replays writes queued offline without ever duplicating them. |
| Change | `PATCH` partial update → `200` + the row. `PUT` sets a singleton's state. Both are idempotent and carry the *desired state* (never "toggle"). The control writes `PATCH /farm`, `PUT /farm/pump` and `PATCH /rules/:id` answer `200` + the refreshed `/farm` snapshot (the clients hydrate their store from it). |
| Delete | `DELETE` → `204`, no body. `404` if absent. |
| Reports | Computed read-only views live under `/reports/*` and are not paged. |
| Shapes | Lists are always JSON arrays — `[]` when empty, never `null` (`items`, the snapshot's `rules`/`irrLog`/`team`, report breakdowns); device `metrics` is always an object. Unset optional values: farm `lat`/`lng` are `null` (sent, so a client merging the snapshot drops a stale value); a row's `fieldId` / field `zone` are omitted when not linked. `payload_contract_test.go` checks the empty-list shapes. |
| Errors | Always `{"error": "<user-facing message>"}`. `400` malformed or out-of-range input (bad JSON, bad query value) — the message is Bengali and names the JSON field, e.g. `ইনপুট ঠিক নেই: text দিতে হবে` · `401` missing/expired token or bad login, with a `WWW-Authenticate` challenge (clients treat it as "session over", so it is never used for other failures) · `403` role too low · `404` missing (also unknown routes) · `405` wrong method · `409` conflict (duplicate email, or a create replayed with the same client `id`) · `422` well-formed but unacceptable: unknown field id, using more stock than exists, self-demotion/deletion, command to a non-relay device, wrong current password, all valves closed, weather without coordinates · `413` body over 1 MiB · `429` login throttled (`Retry-After`) · `502` an upstream (Google sign-in, weather) failed · `503` feature not configured on this server (Google sign-in, weather) or farm not seeded · other `5xx` server (cause is logged, never returned). |
| Caching | Every `/api` response carries `Cache-Control: no-store` (tokens, device keys, live readings). |
| Auth | `Authorization: Bearer <JWT>` (15 min) + refresh token. Devices use `X-Device-Key` on `POST /telemetry` only. |
| Roles | viewer (দর্শক) ⊂ operator (অপারেটর) ⊂ owner (মালিক); enforced per route group, plus a few field-level owner checks in handlers. |
| Validation | Out-of-range input is `400`, never stored: passwords ≥ 8 characters; ledger `amount` > 0; stock `qty`/`min` ≥ 0; task `text` non-empty, `due` one of `আজ` / `কাল` / `এই সপ্তাহ` / `পরে` (or give `dueAt`, which then decides the label), `repeatDays` 0–365; field `plants`/`harvestAt` whole numbers (`harvestAt` ≥ 1); schedule `time` strictly `HH:MM` (the engine matches the string exactly), `dur` 1–240, `zone` one of `সব জোন` / `জোন ক` / `জোন খ` / `জোন গ` (anything else would water nothing); farm `lat` −90–90, `lng` −180–180, `farmName` 1–100 characters, `valves` 1–32 zones; field `name` ≤ 100 and `crop` ≤ 60 characters; stock `name` ≤ 100 and `unit` ≤ 30 characters; harvest and market-price `at` and telemetry `ts` not in the future (5 min clock skew allowed); irrigation `threshold` 0–100 and `duration` 1–240; watering `minutes` 1–240; `maxDailyMinutes` 0–1440; phone `+` and 10–15 digits. |
| Time | Timestamps in stored rows are epoch milliseconds (`at`, `start`, `end`), telemetry `ts` is RFC 3339. Day bucketing uses Asia/Dhaka (UTC+6). |

## Routes

### Open
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` (unversioned) | `200` only while the database answers (`503` otherwise) |
| GET | `/auth/config` | Google client id for the login screens |
| POST | `/auth/login` · `/auth/refresh` · `/auth/google` | token pair |
| POST | `/telemetry` | device ingest, [docs/05](05-device-protocol.md); `X-Device-Key` |

### Any logged-in role
| Method | Path | Notes |
|---|---|---|
| GET | `/auth/me` · POST `/auth/logout` · POST `/auth/password` | own account. Logout `{refreshToken}` → `204`. Password `{currentPassword, newPassword}` → `204`; a wrong current password is `422` (not `401`, which the clients would read as "session over") |
| PATCH | `/auth/me` | own name, `phone` (SMS) and `telegramChat` — where alerts and the weekly summary reach this person |
| GET | `/farm` | control snapshot (state, rules, recent log, team) |
| GET | `/fields` `/tasks` `/ledger` `/stock` `/schedules` `/observations` `/harvests` `/market-prices` `/devices` `/alerts` | paged; filters per resource in the handler doc comments. Tasks: `?overdue=true&field=`, soonest deadline first. Stock: `?low=true` is the shopping list (minimum set and `qty <= min`, the same test as the low-stock alert). Observations: `?field=`. Alerts: `?active=true` holding now, `?active=false` cleared |
| GET | `/crop-templates` | the built-in crop calendar (family, sowing months, days to harvest, water need, dated jobs) |
| GET | `/fields/:id/recommendations?month=` | next-crop ranking with the reason behind every score (`internal/recommend`) |
| GET | `/telemetry` · `/telemetry/buckets` | raw rows (paged) · averaged buckets for charts |
| GET | `/pump-runs?days=` | pump runs, paged |
| GET | `/reports/ledger-summary?from=&to=` | income, expense, profit and per-category totals over the whole ledger (SQL, not limited to a page) |
| GET | `/reports/field-profit?from=&to=` | income, expense, profit and profit per শতক for each field, from ledger entries tagged with it (plus an untagged row) |
| GET | `/reports/weekly-summary` | the last 7 days: litres, income/expense, harvest, open and overdue tasks, low stock, active alerts — the same numbers as the Friday message |
| GET | `/reports/water-use?days=` | litres total, per zone, per day |
| GET | `/reports/field-efficiency?days=` | litres per kg per field |
| GET | `/stream` | live updates as Server-Sent Events (`text/event-stream`): `farm` (the `/farm` snapshot — always the first event, then after every change, at most about once a second), `telemetry` (one stored reading), `alerts` / `devices` (`{}`: that list changed, refetch it), `expired` (the access token ran out; the stream closes — refresh and reconnect). No replay: after a reconnect start from the first snapshot and refetch lists. Bearer header as usual (read it with `fetch`; `EventSource` cannot send headers). `503` when the server runs without the hub or holds 500 streams (`Retry-After`). See `internal/api/stream.go` |
| GET | `/weather` | `422` until the farm has coordinates; `503` when the server runs without the weather service; `502` when Open-Meteo fails |

### Operator + owner
| Method | Path | Notes |
|---|---|---|
| PATCH | `/farm` | irrigation fields; name, location, notifications, `pumpFlowLpm`, `maxDailyMinutes` (daily pump cap for auto mode, 0 = none) are owner-only |
| PUT | `/farm/pump` | `{state: "on"\|"off"}` — switches to manual mode |
| POST | `/farm/waterings` · `/farm/tank-fills` | `201` + snapshot; body `{zones, minutes?}` / none |
| PATCH | `/rules/:id` | `{on: bool}` (required) → `200` + snapshot |
| PATCH | `/alerts/:id` | `{ack: bool}` — the only place alerts are acknowledged |
| POST | `/devices/:id/commands` | `{command: "on"\|"off"}` → `201` + the relay row; relays only (`422` otherwise); same code path as `PUT /farm/pump` (`internal/pump`) |
| POST·PATCH·DELETE | `/tasks`, `/schedules` | |
| POST | `/observations`, `/harvests` | `addIncome` on a harvest additionally needs owner |
| POST | `/stock/:id/usages` | `{qty, fieldId?, cost?, cat?}` → `201` + `{item, ledger}` (`ledger` is `null` without a cost) — stock goes down (`422` if more than exists); a `cost` books an expense on the field and needs owner |

### Owner only
| Method | Path | Notes |
|---|---|---|
| POST·DELETE | `/fields`, `/ledger`, `/stock` (+PATCH) | money and land |
| PATCH | `/fields/:id` | correct or re-plant a field without losing its history |
| POST | `/crop-templates/:id/applications` | `{fieldId}` → `201` + `{field, tasks}`: the field takes the crop, its age restarts and the template's jobs become dated tasks |
| POST·DELETE | `/market-prices` | the price book that feeds the advice |
| DELETE | `/harvests/:id` | |
| GET·POST·PATCH·DELETE | `/users` | paged list; cannot demote/delete yourself; a password reset (`PATCH {password}`) also ends that account's refresh sessions |
| GET·POST | `/devices/:id/key` | reveal / rotate the device ingest key |
| GET | `/audit` | paged, newest first, user-administration entries included; `?q=` (user/detail) `&action=&from=&to=` |

## Notifications

Alert activations and the Friday-08:00 weekly summary go to the channels the farm has switched on (Settings → notifications): the shared Telegram chat (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`), each user's own Telegram chat, and each user's phone through an HTTP SMS gateway (`SMS_GATEWAY_URL`, see `.env.example` for the request shape). Sending never blocks the engine; failures are logged. Server-generated texts (alerts, recommendation reasons) are Bengali.

## Where shared logic lives (so it exists once)

| Concern | Location |
|---|---|
| Error bodies, 404/500 helpers, "find row in this farm", generic DELETE, `from`/`to` filter | `api/respond.go` |
| Paging, search, query-parameter parsing | `api/paging.go` |
| Pump on/off + relay row + log + water account | `internal/pump` |
| Water account and litres per kg | `internal/water` |
| Bengali digits, zone labels | `internal/bangla`, `models.ZoneLabel` |
| Farm clock (Asia/Dhaka) for schedules, day limits, deadlines | `models.FarmZone` |
| Crop calendar data / next-crop scoring | `internal/crops` (`crops.json`) / `internal/recommend` |
| Telegram + SMS delivery / weekly summary | `internal/notify` / `internal/report` |
| Integration-test database (one schema per package) | `internal/testutil` |

## Known limits (deliberate, for later)
- CORS is off by default (same-origin: the server serves the dashboard, Vite proxies in dev). Set `CORS_ORIGINS` (comma-separated, or `*`) to allow a browser app on another origin.
- Login, refresh and Google sign-in are limited to 10 attempts per minute per client IP, in memory (`api/ratelimit.go`). Behind a reverse proxy, configure trusted proxies so the real client IP is seen, and keep a proxy-level limit for multi-instance setups.
- Single-farm: handlers resolve "the" farm with `currentFarm`; multi-farm needs a farm in the path or token.
- Crop-template values (sowing months, days to harvest, water need) are starting points: have a local agriculture extension officer check them for your area before relying on the advice.
- The weekly summary and alerts are single-farm and Bengali-only on the server side.
- Lists in the dashboard and mobile fetch up to 200 rows (the page maximum) and search/filter them in memory; money totals come from `/reports/ledger-summary`, but other lists (tasks, stock…) would need server-side `q`/`page` in the UI beyond ~200 rows.
