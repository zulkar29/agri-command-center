import { describe, expect, it } from 'vitest'
import { demoBuckets, demoPumpRuns } from '@/data/demo-series'
import type { PumpRun, TelemetryBucket } from '@/services/analytics'
import { deriveAnalytics, insightsFor, withRecentForecast } from './derive'

const H = 3_600_000
const T0 = Date.parse('2026-10-08T00:00:00Z')

const bucket = (h: number, soil: number[], temp = 28, rh = 70, tank: number | null = 60): TelemetryBucket => ({
  ts: new Date(T0 + h * H).toISOString(), count: 4, soil_moisture: soil, air_temp: temp, air_humidity: rh, tank_level: tank, battery_v: 12.4,
})

describe('deriveAnalytics', () => {
  it('forecasts each zone and splits run litres over its zones', () => {
    const buckets = [0, 1, 2, 3, 4].map((h) => bucket(h, [50 - 2 * h, 40 - h]))
    const runs: PumpRun[] = [{ id: 'r', start: T0, end: T0 + 0.5 * H, zones: [0, 1], litres: 300, source: 'auto' }]
    const a = deriveAnalytics(buckets, runs, 35, 1)
    expect(a.zones[0].ratePerHour).toBeCloseTo(2)
    expect(a.zones[0].hoursToThreshold).toBeCloseTo(3.5) // 42 → 35 at 2 %/h
    expect(a.zones.map((z) => z.litres)).toEqual([150, 150])
    expect(a.litres).toBe(300)
    expect(a.waterByDay).toHaveLength(1)
    expect(a.soilDelta).toBe(-6)
  })

  it('counts stress, heat and fungal hours by bucket length', () => {
    const buckets = [bucket(0, [30], 36, 50), bucket(1, [50], 24, 90), bucket(2, [50], 24, 92)]
    const a = deriveAnalytics(buckets, [], 35, 1)
    expect(a.stressHours).toBe(1)
    expect(a.heatHours).toBe(1)
    expect(a.fungalHours).toBe(2)
  })

  it('handles an empty span without NaN', () => {
    const a = deriveAnalytics([], [], 35, 1)
    expect(a.soilNow).toBeNull()
    expect(a.idealShare).toBe(0)
    expect(insightsFor(a)[0].key).toBe('allGood')
  })
})

describe('insightsFor', () => {
  it('puts a zone below the threshold first', () => {
    const a = deriveAnalytics([0, 1, 2, 3].map((h) => bucket(h, [30, 60])), [], 35, 1)
    expect(insightsFor(a)[0]).toMatchObject({ key: 'waterNow', zone: 0, tone: 'bad' })
  })
})

describe('demo series', () => {
  it('produces every span with plausible values and runs', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    for (const [span, min] of [['24h', 90], ['7d', 160], ['30d', 110]] as const) {
      const b = demoBuckets(span, 35, now)
      expect(b.length).toBeGreaterThanOrEqual(min)
      expect(b.every((x) => x.soil_moisture.length === 3 && x.soil_moisture.every((v) => v > 0 && v <= 100))).toBe(true)
    }
    expect(demoPumpRuns(7, 35, now).length).toBeGreaterThan(3)
  })
})

describe('withRecentForecast', () => {
  it('takes zone forecasts from the recent span and keeps the rest', () => {
    const coarse = deriveAnalytics([bucket(0, [50]), bucket(6, [48])], [], 35, 6)
    const recent = deriveAnalytics([0, 1, 2, 3].map((h) => bucket(h, [44 - h])), [], 35, 1)
    const merged = withRecentForecast(coarse, recent)
    expect(merged.zones[0].ratePerHour).toBeCloseTo(1)
    expect(merged.zones[0].hoursToThreshold).toBeCloseTo(6)
    expect(merged.soilAvg).toBe(coarse.soilAvg)
  })
})
