import type { PumpRun, Span, TelemetryBucket } from '@/services/analytics'
import { SPANS } from '@/services/analytics'

/**
 * নমুনা মোড chart data in the live shapes, so demo and live share one
 * analytics page. A deterministic 30-day farm at 15-minute resolution: soil
 * dries faster by day, auto irrigation tops a zone up when it nears the
 * threshold, the tank drains with each run and is refilled, temperature and
 * humidity follow the day (with a few hot days and a humid spell), and the
 * battery charges from a panel. Ends at `now`, so the charts look current.
 */

const STEP = 15 * 60_000
const DAYS = 30

/** Small deterministic noise in [-1, 1]. */
function noise(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}

interface Raw {
  t: number
  soil: number[]
  temp: number
  rh: number
  tank: number
  batt: number
}

let cache: { key: string; raw: Raw[]; runs: PumpRun[] } | null = null

function simulate(threshold: number, now: number) {
  // stable within a 15-minute slot so charts do not jump on every render
  const end = Math.floor(now / STEP) * STEP
  const key = `${threshold}:${end}`
  if (cache?.key === key) return cache

  const n = (DAYS * 24 * 60 * 60_000) / STEP
  const soil = [58, 50, 44]
  const dryPerHour = [0.55, 0.7, 0.95] // zone গ is sandier
  let tank = 82
  const raw: Raw[] = []
  const runs: PumpRun[] = []
  for (let i = 0; i < n; i++) {
    const t = end - (n - 1 - i) * STEP
    const d = new Date(t)
    const hour = d.getHours() + d.getMinutes() / 60
    const day = Math.floor(i / 96)
    const sun = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) // 0 at night, 1 at noon
    const hotDay = day % 9 === 4 ? 3.5 : 0
    const humidSpell = day % 11 >= 7 && day % 11 <= 8 ? 16 : 0
    const temp = 25 + 8.5 * sun + hotDay + noise(i, 1) * 0.6
    const rh = Math.min(98, 80 - 26 * sun + humidSpell + noise(i, 2) * 2)

    const watered: number[] = []
    for (let z = 0; z < soil.length; z++) {
      soil[z] -= (dryPerHour[z] * (0.35 + 1.1 * sun) * STEP) / 3_600_000
      soil[z] += noise(i, 3 + z) * 0.15
      // the controller reacts a little late, so zones dip just under the line
      if (soil[z] < threshold - 1 && tank > 12) watered.push(z)
    }
    if (watered.length) {
      for (const z of watered) soil[z] = Math.min(78, soil[z] + 27)
      tank -= 3.2 * watered.length
      runs.push({ id: `demo-run-${i}`, start: t, end: t + 18 * 60_000, zones: watered, litres: 160 * watered.length, source: 'auto' })
    }
    tank -= 0.02
    if (tank < 24) tank = 92 // refilled
    const batt = 12.15 + 0.55 * sun + noise(i, 9) * 0.03

    raw.push({ t, soil: soil.map((v) => Math.max(5, v)), temp, rh, tank, batt })
  }
  cache = { key, raw, runs }
  return cache
}

const round = (v: number, p = 1) => Math.round(v * 10 ** p) / 10 ** p

/** Demo buckets for a span, averaged like the server's date_bin buckets. */
export function demoBuckets(span: Span, threshold: number, now: number): TelemetryBucket[] {
  const { raw } = simulate(threshold, now)
  const { hours, stepHours } = SPANS[span]
  const since = now - hours * 3_600_000
  const size = stepHours * 3_600_000
  const groups = new Map<number, Raw[]>()
  for (const r of raw) {
    if (r.t < since) continue
    const k = Math.floor(r.t / size) * size
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return [...groups.entries()].map(([k, rs]) => ({
    ts: new Date(k).toISOString(),
    count: rs.length,
    soil_moisture: rs[0].soil.map((_, z) => round(avg(rs.map((r) => r.soil[z])))),
    air_temp: round(avg(rs.map((r) => r.temp))),
    air_humidity: round(avg(rs.map((r) => r.rh))),
    tank_level: round(avg(rs.map((r) => r.tank))),
    battery_v: round(avg(rs.map((r) => r.batt)), 2),
  }))
}

/** Demo pump runs of the last `days` days, newest first like the API. */
export function demoPumpRuns(days: number, threshold: number, now: number): PumpRun[] {
  const since = now - days * 86_400_000
  return simulate(threshold, now)
    .runs.filter((r) => r.start >= since)
    .reverse()
}
