import { declineRate, HEAT_STRESS_C, hoursUntil, hoursWhere, isFungalRisk, moistureBands, shareInRange, vpd, vpdZone, type Point, type VpdZone } from '@/lib/agro'
import { mean } from '@/lib/farm'
import type { PumpRun, TelemetryBucket } from '@/services/analytics'

/** Everything the analytics page draws or says, from one span of buckets and pump runs. */
export interface Analytics {
  zones: ZoneStat[]
  /** average soil across zones per bucket */
  soilAvg: Point[]
  soilNow: number | null
  soilDelta: number | null
  /** share of buckets with every zone inside the ideal band */
  idealShare: number
  /** hours with at least one zone below the threshold */
  stressHours: number
  temp: Point[]
  humidity: Point[]
  vpd: Point[]
  vpdNow: number | null
  vpdNowZone: VpdZone | null
  vpdIdealShare: number
  tempMax: number | null
  tempMin: number | null
  heatHours: number
  fungalHours: number
  tank: Point[]
  tankNow: number | null
  tankHoursToRefill: number | null
  battery: Point[]
  litres: number
  runs: number
  /** litres per farm day per zone, oldest first */
  waterByDay: { day: number; perZone: number[] }[]
  spans: { start: number; end: number }[]
}

export interface ZoneStat {
  index: number
  points: Point[]
  now: number | null
  /** % per hour lost since the last watering (0 = not drying, null = unknown) */
  ratePerHour: number | null
  /** hours until the threshold at that rate (0 = below already) */
  hoursToThreshold: number | null
  idealShare: number
  litres: number
}

/** The tank level worth refilling at, as on the tank alert. */
export const TANK_REFILL = 30

const r1 = (v: number) => Math.round(v * 10) / 10

export function deriveAnalytics(buckets: TelemetryBucket[], runs: PumpRun[], threshold: number, stepHours: number): Analytics {
  const t = (b: TelemetryBucket) => Date.parse(b.ts)
  const { dryBelow, wetAbove } = moistureBands(threshold)
  const zoneCount = buckets.reduce((n, b) => Math.max(n, b.soil_moisture.length), 0)

  const litresPerZone = Array.from({ length: zoneCount }, () => 0)
  const byDay = new Map<number, number[]>()
  for (const run of runs) {
    const zones = run.zones.length ? run.zones : [0]
    const share = run.litres / zones.length
    const d = new Date(run.start)
    d.setHours(0, 0, 0, 0)
    const key = d.getTime()
    if (!byDay.has(key)) byDay.set(key, Array.from({ length: Math.max(zoneCount, 1) }, () => 0))
    for (const z of zones) {
      if (z < litresPerZone.length) litresPerZone[z] += share
      const row = byDay.get(key)!
      if (z < row.length) row[z] += share
    }
  }

  const zones: ZoneStat[] = Array.from({ length: zoneCount }, (_, z) => {
    const points = buckets.filter((b) => b.soil_moisture[z] !== undefined).map((b) => ({ t: t(b), v: b.soil_moisture[z] }))
    const now = points.length ? points[points.length - 1].v : null
    const rate = declineRate(points)
    return {
      index: z,
      points,
      now,
      ratePerHour: rate,
      hoursToThreshold: now === null ? null : hoursUntil(now, rate, threshold),
      idealShare: shareInRange(points.map((p) => p.v), dryBelow, wetAbove),
      litres: Math.round(litresPerZone[z]),
    }
  })

  const soilAvg = buckets.filter((b) => b.soil_moisture.length).map((b) => ({ t: t(b), v: r1(mean(b.soil_moisture)) }))
  const temp = buckets.map((b) => ({ t: t(b), v: b.air_temp }))
  const humidity = buckets.map((b) => ({ t: t(b), v: b.air_humidity }))
  const vpdPts = buckets.map((b) => ({ t: t(b), v: Math.round(vpd(b.air_temp, b.air_humidity) * 100) / 100 }))
  const tank = buckets.filter((b) => b.tank_level !== null && b.tank_level > 0).map((b) => ({ t: t(b), v: b.tank_level as number }))
  const tankNow = tank.length ? tank[tank.length - 1].v : null
  const vpdNow = vpdPts.length ? vpdPts[vpdPts.length - 1].v : null
  const temps = temp.map((p) => p.v)

  return {
    zones,
    soilAvg,
    soilNow: soilAvg.length ? soilAvg[soilAvg.length - 1].v : null,
    soilDelta: soilAvg.length > 1 ? r1(soilAvg[soilAvg.length - 1].v - soilAvg[0].v) : null,
    idealShare: buckets.length ? buckets.filter((b) => b.soil_moisture.length && b.soil_moisture.every((v) => v >= dryBelow && v <= wetAbove)).length / buckets.length : 0,
    stressHours: hoursWhere(buckets, stepHours, (b) => b.soil_moisture.some((v) => v < threshold)),
    temp,
    humidity,
    vpd: vpdPts,
    vpdNow,
    vpdNowZone: vpdNow === null ? null : vpdZone(vpdNow),
    vpdIdealShare: shareInRange(vpdPts.map((p) => p.v), 0.8, 1.2),
    tempMax: temps.length ? Math.max(...temps) : null,
    tempMin: temps.length ? Math.min(...temps) : null,
    heatHours: hoursWhere(buckets, stepHours, (b) => b.air_temp >= HEAT_STRESS_C),
    fungalHours: hoursWhere(buckets, stepHours, (b) => isFungalRisk(b.air_temp, b.air_humidity)),
    tank,
    tankNow,
    tankHoursToRefill: tankNow === null ? null : hoursUntil(tankNow, declineRate(tank, 5), TANK_REFILL),
    battery: buckets.filter((b) => b.battery_v > 0).map((b) => ({ t: t(b), v: b.battery_v })),
    litres: Math.round(runs.reduce((a, r) => a + r.litres, 0)),
    runs: runs.length,
    waterByDay: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, perZone]) => ({ day, perZone: perZone.map(Math.round) })),
    spans: runs.map((r) => ({ start: r.start, end: Math.max(r.end, r.start + 5 * 60_000) })),
  }
}

/** One actionable line for the "এখন কী করবেন" panel; key picks the text (ag.insight.<key>). */
export interface Insight {
  key: 'waterNow' | 'waterSoon' | 'fungal' | 'heat' | 'offBand' | 'tank' | 'thirsty' | 'allGood'
  tone: 'bad' | 'warn' | 'info' | 'ok'
  zone?: number
  n?: number
}

/** The few things worth doing now, most urgent first. */
export function insightsFor(a: Analytics): Insight[] {
  const out: Insight[] = []
  for (const z of a.zones) {
    if (z.hoursToThreshold === 0) out.push({ key: 'waterNow', tone: 'bad', zone: z.index })
    else if (z.hoursToThreshold !== null && z.hoursToThreshold <= 6) out.push({ key: 'waterSoon', tone: 'warn', zone: z.index, n: Math.max(1, Math.round(z.hoursToThreshold)) })
  }
  if (a.tankHoursToRefill !== null && a.tankHoursToRefill <= 12) out.push({ key: 'tank', tone: a.tankHoursToRefill === 0 ? 'bad' : 'warn', n: Math.round(a.tankHoursToRefill) })
  if (a.fungalHours >= 6) out.push({ key: 'fungal', tone: 'warn', n: a.fungalHours })
  if (a.heatHours > 0) out.push({ key: 'heat', tone: 'warn', n: a.heatHours })
  if (a.soilAvg.length > 4 && a.idealShare < 0.6) out.push({ key: 'offBand', tone: 'info', n: Math.round(a.idealShare * 100) })
  const thirsty = [...a.zones].sort((x, y) => y.litres - x.litres)[0]
  if (thirsty && thirsty.litres > 0 && a.zones.length > 1) out.push({ key: 'thirsty', tone: 'info', zone: thirsty.index, n: thirsty.litres })
  if (!out.some((i) => i.tone === 'bad' || i.tone === 'warn')) out.unshift({ key: 'allGood', tone: 'ok' })
  const rank = { bad: 0, warn: 1, ok: 2, info: 3 }
  return out.sort((x, y) => rank[x.tone] - rank[y.tone])
}

/**
 * The zone forecasts (drying rate, hours to the threshold) taken from a
 * finer recent span — 6-hour buckets over 30 days are too coarse to see a
 * day's drying — while every other number keeps the chosen span.
 */
export function withRecentForecast(a: Analytics, recent: Analytics | null): Analytics {
  if (!recent) return a
  return {
    ...a,
    zones: a.zones.map((z) => {
      const r = recent.zones[z.index]
      return r ? { ...z, now: r.now ?? z.now, ratePerHour: r.ratePerHour, hoursToThreshold: r.hoursToThreshold } : z
    }),
  }
}
