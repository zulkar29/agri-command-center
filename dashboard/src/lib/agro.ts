/**
 * Agronomy from sensor series: the numbers a grower acts on, computed from
 * the averaged telemetry buckets. Pure and clock-free so it is easy to test.
 *
 * Thresholds are deliberately simple field rules, not crop models:
 *   - soil: below the farm's irrigation threshold is "dry" (the crop is
 *     stressed), up to threshold + 30 is the comfortable band, above is wet;
 *   - VPD (vapour-pressure deficit, kPa) — how hard the air pulls water out
 *     of leaves: < 0.4 the leaves stay wet (fungal disease), 0.8–1.2 suits
 *     most vegetables, > 1.6 the plant closes its pores and stops growing;
 *   - fungal risk hours: humidity ≥ 85 % at 15–30 °C, the blight/mildew window;
 *   - heat stress: ≥ 35 °C, where most vegetables drop flowers.
 */

/** One reading on a timeline (t in epoch ms). */
export interface Point {
  t: number
  v: number
}

/** VPD in kPa from air temperature (°C) and relative humidity (%), Tetens' formula. */
export function vpd(tempC: number, rh: number): number {
  const es = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3))
  return Math.max(0, es * (1 - Math.min(100, Math.max(0, rh)) / 100))
}

export type VpdZone = 'disease' | 'low' | 'ideal' | 'high' | 'stress'

export const VPD_LIMITS = { disease: 0.4, low: 0.8, ideal: 1.2, high: 1.6 } as const

export function vpdZone(kpa: number): VpdZone {
  if (kpa < VPD_LIMITS.disease) return 'disease'
  if (kpa < VPD_LIMITS.low) return 'low'
  if (kpa <= VPD_LIMITS.ideal) return 'ideal'
  if (kpa <= VPD_LIMITS.high) return 'high'
  return 'stress'
}

export const HEAT_STRESS_C = 35

export const isFungalRisk = (tempC: number, rh: number) => rh >= 85 && tempC >= 15 && tempC <= 30

/** The soil-moisture bands for a farm threshold: [dry, ideal, wet] upper edges. */
export function moistureBands(threshold: number): { dryBelow: number; wetAbove: number } {
  return { dryBelow: threshold, wetAbove: Math.min(100, threshold + 30) }
}

/** Share (0–1) of values inside [lo, hi]. */
export function shareInRange(values: number[], lo: number, hi: number): number {
  if (!values.length) return 0
  return values.filter((v) => v >= lo && v <= hi).length / values.length
}

/** Least-squares slope of v per hour. */
function slopePerHour(points: Point[]): number {
  const n = points.length
  const t0 = points[0].t
  const xs = points.map((p) => (p.t - t0) / 3_600_000)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = points.reduce((a, p) => a + p.v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (points[i].v - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

/**
 * How fast a level is falling, in units per hour (0 when it is not falling),
 * from the stretch since the last refill — a jump up of more than `jump`
 * (watering for soil, a fill for the tank). null when that stretch is too
 * short (under 3 points or 2 hours) to tell.
 */
export function declineRate(points: Point[], jump = 2): number | null {
  let start = 0
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].v - points[i - 1].v > jump) {
      start = i
      break
    }
  }
  const seg = points.slice(start)
  if (seg.length < 3 || seg[seg.length - 1].t - seg[0].t < 2 * 3_600_000) return null
  return Math.max(0, -slopePerHour(seg))
}

/** Hours until `current` falls to `target` at `ratePerHour`; 0 if already there, null if it is not falling. */
export function hoursUntil(current: number, ratePerHour: number | null, target: number): number | null {
  if (current <= target) return 0
  if (!ratePerHour || ratePerHour <= 0) return null
  return (current - target) / ratePerHour
}

/** Hours (rounded) covered by the items matching pred, each item being `stepHours` long. */
export function hoursWhere<T>(items: T[], stepHours: number, pred: (x: T) => boolean): number {
  return Math.round(items.filter(pred).length * stepHours)
}
