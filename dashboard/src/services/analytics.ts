import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { http } from './http'
import { liveStreamAtom } from './live'
import type { Page } from '@/types'

/**
 * Chart data for বিশ্লেষণ and the overview: telemetry averaged per time
 * bucket (GET /api/v1/telemetry/buckets — small payloads even for 30 days)
 * and the pump runs that explain every rise in soil moisture.
 */

/** One averaged slice (backend telemetryBucket). tank_level is null when no reading carried one. */
export interface TelemetryBucket {
  ts: string
  count: number
  soil_moisture: number[]
  air_temp: number
  air_humidity: number
  tank_level: number | null
  battery_v: number
}

/** One pump run (GET /api/v1/pump-runs): epoch ms, zone indexes, litres from the measured flow. */
export interface PumpRun {
  id: string
  start: number
  end: number
  zones: number[]
  litres: number
  source: string
}

export type Span = '24h' | '7d' | '30d'

/** Window, bucket size and run look-back per span; stepHours is one bucket's length. */
export const SPANS: Record<Span, { hours: number; bucket: string; stepHours: number; days: number }> = {
  '24h': { hours: 24, bucket: '15m', stepHours: 0.25, days: 1 },
  '7d': { hours: 168, bucket: '1h', stepHours: 1, days: 7 },
  '30d': { hours: 720, bucket: '6h', stepHours: 6, days: 30 },
}

export const analyticsService = {
  buckets: (span: Span, node?: string) =>
    http.get<{ bucket: string; items: TelemetryBucket[] }>(
      `/telemetry/buckets?hours=${SPANS[span].hours}&bucket=${SPANS[span].bucket}${node ? `&node=${encodeURIComponent(node)}` : ''}`,
    ),
  pumpRuns: (days: number) => http.get<Page<PumpRun>>(`/pump-runs?days=${days}&limit=200`),
}

/** Averaged telemetry for a span. The live stream refreshes it as readings arrive (services/live.ts). */
export function useTelemetryBuckets(span: Span, enabled: boolean, node?: string) {
  const streaming = useAtomValue(liveStreamAtom)
  return useQuery({
    queryKey: ['telemetry-buckets', span, node ?? ''],
    queryFn: () => analyticsService.buckets(span, node).then((r) => r.items),
    enabled,
    retry: false,
    refetchInterval: streaming ? 5 * 60_000 : 60_000,
  })
}

/** Pump runs of the last `days` days (newest first, up to 200). */
export function usePumpRuns(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['pump-runs', days],
    queryFn: () => analyticsService.pumpRuns(days).then((p) => p.items),
    enabled,
    retry: false,
    refetchInterval: 2 * 60_000,
  })
}
