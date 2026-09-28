# Services (API layer + query hooks)

Pages read and mutate server data through the hooks in this folder. Every
backend call is a plain async function; the hooks wrap them in
[TanStack Query](https://tanstack.com/query). Components never call `fetch`
directly.

## Conventions

1. **`http.ts`** — shared typed fetch wrapper (`http.get/post/patch/delete`), base URL from `VITE_API_URL`.
   It attaches the login token from `atoms/auth.ts` as a bearer header and
   clears the session (→ login screen) when the server answers 401.
2. **One file per resource** — `auth.ts` (login/logout/refresh/Google),
   `farm.ts` (control), `tasks.ts`, `fields.ts`, `finance.ts`,
   `inventory.ts`, `schedules.ts`, `devices.ts`. Functions return typed data
   and throw `ApiError` on failure.
3. **`Page<T>` envelope** — every list endpoint answers `{items, total, page, limit, pages}`
   and takes `?q=&page=&limit=` plus resource filters (`tasks`: done/urgent/due,
   `ledger`: type/cat/from/to, `stock`: low, `devices`: kind/online,
   `telemetry`: hours/node). Hooks unwrap `items`; pass filters through
   `useList(key, path, selectDemo, params)`.
4. **`source.ts`** — the dual-source helpers:
   - `useList(key, path, selectDemo, params?)` — the list to print: TanStack Query
     while a backend is connected, the demo store while `simulate` is on.
   - `useMutate(key, demoFn, apiFn, okMsg?)` — mutation that runs the demo
     action or the REST endpoint and invalidates `key` on success.
5. **Server state vs client state**: collections (tasks, fields, ledger, stock,
   schedules, devices) belong to TanStack Query. jotai (`src/atoms/`) keeps only
   global state — farm control (pump, valves, thresholds, rules), the demo
   data + simulator, and the login session. `useLiveFarm` (`farm.ts`) hydrates the
   control snapshot (`FarmSnapshot` — `GET /api/v1/farm` does not embed
   collections) into the store; switching demo ↔ live invalidates all query
   caches. Live mode requires a login (demo account: owner@farm.com /
   farm123) — the route guard in App.tsx sends unauthenticated users to the
   login page. Write affordances gate on role via `useCan()` from
   `atoms/auth.ts` (matrix mirrors backend/internal/api/router.go).
6. **Live stream**: `useLiveStream` (`live.ts`, mounted by `useLiveFarm`)
   keeps one `GET /api/v1/stream` (Server-Sent Events) open and writes its
   events into the query cache — the snapshot, chart refreshes, and
   refetches of alerts/devices. While it is up (`liveStreamAtom`) the hooks
   poll only as a slow safety net; when it drops they poll as before.
7. **Charts**: time series come from `GET /telemetry/buckets` and
   `GET /pump-runs` (`analytics.ts`); নমুনা মোড feeds the same charts from
   `data/demo-series.ts`. The agronomy (VPD, drying rate, forecasts, risk
   hours) is pure code in `lib/agro.ts` and `pages/analytics/derive.ts`, and
   every chart takes its look from `lib/chart-theme.ts`.

The REST API is documented in `docs/05-device-protocol.md` (payload) and
`backend/internal/api/router.go` (routes). User-facing strings go through
i18next (`src/i18n/`), never hardcoded — see docs/08's ভাষা section.
