import { bn } from './format'
import i18n from '@/i18n'

/**
 * Sample history for the demo-mode charts, ported from
 * dashboard/src/data/history.ts. Deterministic, so charts do not jump on
 * every render; live mode reads /api/v1/telemetry instead.
 */

const BASE_WATER = [380, 420, 0, 410, 520, 260, 450]
const BASE_MOIST = [41, 39, 52, 43, 38, 47, 42]
const BASE_TEMP = [29, 30, 27, 28, 31, 29, 28]
const BASE_HUM = [74, 71, 88, 76, 70, 82, 78]

// month labels localize at render time via i18next m.monthsShort

export interface DailySeries {
  labels: string[]
  water: number[]
  moisture: number[]
  temp: number[]
  humidity: number[]
}

export function dailySeries(n: number): DailySeries {
  const labels: string[] = []
  const water: number[] = []
  const moisture: number[] = []
  const temp: number[] = []
  const humidity: number[] = []
  const now = Date.now()
  for (let i = 0; i < n; i += 1) {
    const w = BASE_WATER[i % 7]
    const adj = n === 7 ? 0 : 1
    const d = new Date(now - (n - 1 - i) * 86_400_000)
    labels.push(`${bn(d.getDate())} ${(i18n.t('m.monthsShort', { returnObjects: true }) as string[])[d.getMonth()]}`)
    water.push(w === 0 ? 0 : w + adj * (((i * 37) % 60) - 30))
    moisture.push(BASE_MOIST[i % 7] + adj * (((i * 7) % 9) - 4))
    temp.push(BASE_TEMP[i % 7] + adj * (((i * 5) % 5) - 2))
    humidity.push(BASE_HUM[i % 7] + adj * (((i * 3) % 7) - 3))
  }
  return { labels, water, moisture, temp, humidity }
}

export interface HourlySeries {
  labels: string[]
  zones: number[][]
}

/** Last 24 hours of soil moisture per zone (demo mode). */
export function hourlyMoisture(): HourlySeries {
  const nowHour = new Date().getHours()
  const labels: string[] = []
  const bases = [44, 38, 31]
  const zones: number[][] = [[], [], []]
  for (let i = 0; i < 24; i += 1) {
    const hour = (nowHour - 23 + i + 24) % 24
    labels.push(`${bn(String(hour).padStart(2, '0'))}:০০`)
    for (let z = 0; z < 3; z += 1) {
      const wave = 5 * Math.sin((i / 24) * Math.PI * 2 + z)
      const irrigated = hour >= 7 && hour < 9 ? 8 : 0
      zones[z].push(Math.round((bases[z] + wave + irrigated) * 10) / 10)
    }
  }
  return { labels, zones }
}
