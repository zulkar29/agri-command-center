import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bn } from '@/lib/format'
import { hourlyMoisture, type HourlySeries } from '@/lib/history'
import type { FarmSnapshot, Page, TelemetryRow } from '@/lib/types'
import { apiFetch, http } from './http'

/**
 * Farm control API — the mobile twin of dashboard's services/farm.ts.
 * GET /api/v1/farm returns the control snapshot (state + zones/rules/irrigation
 * log — collections with their own endpoints are not embedded), and the
 * control mutations below resolve to a fresh snapshot, so the global store
 * can hydrate each response directly (backend: internal/api/farm.go).
 *
 * Screen data (tasks, fields, ledger, stock, schedules, devices) does NOT go
 * through here — screens read those through the query hooks in this folder.
 */
export const farmService = {
  /** The liveness probe is the one route outside /api/v1, so it bypasses the version prefix. */
  health: () => apiFetch<{ status: string }>('/health', undefined, 10_000, '/api'),
  get: () => http.get<FarmSnapshot>('/farm'),

  update: (patch: Partial<Pick<FarmSnapshot, 'farmName' | 'simulate' | 'mode' | 'threshold' | 'duration' | 'valves' | 'notif' | 'lat' | 'lng' | 'maxDailyMinutes'>>) =>
    http.patch<FarmSnapshot>('/farm', patch),


  setPump: (state: 'on' | 'off') => http.put<FarmSnapshot>('/farm/pump', { state }),
  waterZones: (zones: number[], minutes?: number) =>
    http.post<FarmSnapshot>('/farm/waterings', { zones, minutes }),
  fillTank: () => http.post<FarmSnapshot>('/farm/tank-fills', {}),

  /** Answers with the fresh snapshot, so the store hydrates directly. */
  setRule: (id: string, on: boolean) => http.patch<FarmSnapshot>(`/rules/${id}`, { on }),
}

export const telemetryService = {
  /** Stored readings (oldest first) in the Paged envelope. hours: 1..720;
   *  limit/page and node filter optional. */
  list: (hours = 24, node?: string, limit = 1000) =>
    http.get<Page<TelemetryRow>>(
      `/telemetry?hours=${hours}&limit=${limit}${node ? `&node=${node}` : ''}`,
    ),
}

/** Stored telemetry rows for the charts, refreshed every minute while enabled. */
export function useTelemetry(hours = 24, enabled = true) {
  return useQuery({
    queryKey: ['telemetry', hours],
    queryFn: () => telemetryService.list(hours).then((p) => p.items),
    enabled,
    retry: false,
    refetchInterval: 60_000,
  })
}

/**
 * 24-hour soil moisture per zone for the overview chart: while a server is
 * connected the telemetry query feeds it (refreshing every minute); নমুনা
 * মোড and unreachable servers fall back to the sample wave.
 */
export function useMoisture24h(live: boolean): HourlySeries {
  const query = useTelemetry(24, live)
  const rows = query.data

  return useMemo(() => {
    if (!live || !rows || rows.length < 2) return hourlyMoisture()
    const step = Math.max(1, Math.floor(rows.length / 48))
    const picked = rows.filter((_, i) => i % step === 0)
    if (picked[picked.length - 1] !== rows[rows.length - 1]) picked.push(rows[rows.length - 1])
    return {
      labels: picked.map((r) => {
        const h = new Date(r.ts).getHours()
        return `${bn(String(h).padStart(2, '0'))}:০০`
      }),
      zones: [0, 1, 2].map((z) => picked.map((r) => r.soil_moisture[z] ?? 0)),
    }
  }, [live, rows])
}
