# Services (API layer + query hooks)

Screens read and mutate server data through the hooks in this folder — the
mobile twin of `dashboard/src/services/`. Every backend call is a plain async
function; the hooks wrap them in
[TanStack Query](https://tanstack.com/query). Components never call `fetch`
directly.

## Conventions

1. **`http.ts`** — shared typed fetch wrapper (`http.get/post/patch/delete`),
   base URL and bearer token set by the connect screen via `state/conn.ts`.
2. **One file per resource** — `auth.ts` (login/logout/refresh/Google),
   `farm.ts` (control + telemetry), `tasks.ts`, `fields.ts` (+ observations),
   `finance.ts`, `inventory.ts`, `schedules.ts`, `devices.ts`. Functions
   return typed data and throw `ApiError` on failure.
3. **`Page<T>` envelope** — every list endpoint answers
   `{items, total, page, limit, pages}` and takes `?q=&page=&limit=` plus
   resource filters (`tasks`: done/urgent/due, `ledger`: type/cat/from/to,
   `stock`: low, `devices`: kind/online, `telemetry`: hours/node). Hooks
   unwrap `items`; pass filters through `useList(key, path, selectDemo, params)`.
4. **`source.ts`** — the dual-source helpers:
   - `useList(key, path, selectDemo, params?)` — the list to print: TanStack Query
     while নমুনা মোড is off, the demo store (jotai) while it is on.
   - `useMutate(key, demoFn, apiFn, okMsg?)` — mutation that runs the demo
     action or the REST endpoint and invalidates `key` on success.
5. **Server state vs client state**: collections (tasks, fields, ledger,
   stock, schedules, devices, telemetry) belong to TanStack Query. jotai
   (`src/state/`) keeps only global state — farm control (pump, valves,
   thresholds, rules), the demo data + simulator, and the connection +
   login session (`conn.ts` persists both — the tokens in the OS keychain via
   expo-secure-store, see `state/storage.ts`; demo account: owner@farm.com /
   farm123). `state/engine.ts` hydrates the control snapshot
   (`FarmSnapshot` — `GET /api/v1/farm` does not embed collections) into the
   store; a 401 sends the app back to the connect screen; switching
   demo ↔ live clears the whole query cache (`state/conn.ts`).

The REST API is documented in `docs/05-device-protocol.md` (payload) and
`backend/internal/api/router.go` (routes). User-facing strings go through
i18next (`src/i18n/`), never hardcoded — see docs/08's ভাষা section.
