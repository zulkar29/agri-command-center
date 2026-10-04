import { FORECAST, ZONES } from './constants'
import { bn } from './format'
import { zoneLabel } from './labels'
import i18n from '@/i18n'
import type { Due, Field, FarmData, StockItem, Tone, ViewId } from './types'

/** Needs buying: a minimum is set and the stock is at or below it — the same test as the server's low-stock alert and GET /stock?low=true. */
export const isLowStock = (x: Pick<StockItem, 'qty' | 'min'>) => x.min > 0 && x.qty <= x.min

const t = i18n.t.bind(i18n)

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function zoneStatus(v: number, threshold: number): { label: string; tone: Tone } {
  const r = Math.round(v)
  if (r < threshold) return { label: t('zoneStatus.needWater'), tone: 'bad' }
  if (r < threshold + 8) return { label: t('zoneStatus.drying'), tone: 'warn' }
  return { label: t('zoneStatus.fine'), tone: 'ok' }
}

/** A simple rule of thumb on humidity. It is not a disease diagnosis. */
export function riskInfo(humidity: number): { level: string; tone: Tone; advice: string; pct: number } {
  const pct = Math.max(5, Math.min(100, Math.round((humidity - 50) * 2)))
  if (humidity >= 85)
    return { level: t('risk.high'), tone: 'bad', pct, advice: t('risk.highAdvice') }
  if (humidity >= 70)
    return { level: t('risk.medium'), tone: 'warn', pct, advice: t('risk.mediumAdvice') }
  return { level: t('risk.low'), tone: 'ok', pct, advice: t('risk.lowAdvice') }
}

export function fieldStage(f: Field): { label: string; tone: Tone; pct: number; left: string } {
  const pct = Math.min(100, Math.round((f.age / Math.max(1, f.harvestAt)) * 100))
  if (f.age >= f.harvestAt)
    return { label: t('fieldStage.harvestNow'), tone: 'ok', pct, left: t('fieldStage.harvestStarted') }
  const left = t('fieldStage.daysLeft', { n: bn(f.harvestAt - f.age) })
  if (f.age < 15) return { label: t('fieldStage.seedling'), tone: 'neutral', pct, left }
  if (f.age < 40) return { label: t('fieldStage.growing'), tone: 'neutral', pct, left }
  return { label: t('fieldStage.flowering'), tone: 'info', pct, left }
}

export interface AlertItem {
  id: string
  title: string
  detail: string
  tag: string
  tone: Tone
}

export function deriveAlerts(s: FarmData): AlertItem[] {
  const out: AlertItem[] = []
  s.moist.forEach((v, i) => {
    if (Math.round(v) < s.threshold) {
      out.push({
        id: `dry${i}`,
        title: t('alerts.dryZone', { zone: zoneLabel(ZONES[i]) }),
        detail: t('alerts.dryZoneDetail', { v: bn(Math.round(v)), t: bn(s.threshold) }),
        tag: t('alerts.urgent'),
        tone: 'bad',
      })
    }
  })
  if (Math.round(s.tank) < 30) {
    out.push({
      id: 'tank',
      title: t('alerts.tankLow'),
      detail: t('alerts.tankLowDetail', { v: bn(Math.round(s.tank)) }),
      tag: t('alerts.urgent'),
      tone: 'bad',
    })
  }
  if (Math.round(s.humidity) >= 70) {
    out.push({
      id: 'hum',
      title: t('alerts.humHigh'),
      detail: t('alerts.humHighDetail', { v: bn(Math.round(s.humidity)) }),
      tag: t('alerts.watch'),
      tone: 'warn',
    })
  }
  s.stock
    .filter(isLowStock)
    .forEach((x) =>
      out.push({
        id: `stock-${x.id}`,
        title: t('alerts.stockLow', { name: x.name }),
        detail: t('alerts.stockLowDetail', { qty: bn(x.qty), unit: x.unit, min: bn(x.min) }),
        tag: t('alerts.stock'),
        tone: 'warn',
      }),
    )
  return out
}

export interface Rec {
  id: string
  text: string
  tone: Tone
  action?: { label: string; zone?: number; view?: ViewId }
}

/** rainTomorrow: probability % for the r1 rain-skip note — the live forecast
 *  when connected, the sample FORECAST otherwise. */
export function deriveRecs(s: FarmData, rainTomorrow: number = FORECAST[1].rain): Rec[] {
  const recs: Rec[] = []
  s.moist.forEach((v, i) => {
    if (Math.round(v) < s.threshold) {
      recs.push({
        id: `dry${i}`,
        text: t('recs.waterZone', { zone: zoneLabel(ZONES[i]), v: bn(Math.round(v)) }),
        tone: 'bad',
        action: { label: t('recs.water'), zone: i },
      })
    }
  })
  const rainSkip = s.rules.find((r) => r.id === 'r1')?.on ?? false
  const tomorrow = rainTomorrow
  if (rainSkip && tomorrow >= 60) {
    recs.push({
      id: 'rain',
      text: t('recs.rainRule', { n: bn(tomorrow) }),
      tone: 'info',
    })
  }
  const risk = riskInfo(s.humidity)
  if (s.humidity >= 70) {
    recs.push({
      id: 'risk',
      text: t('recs.riskCheck', { v: bn(Math.round(s.humidity)), level: risk.level }),
      tone: 'warn',
      action: { label: t('recs.note'), view: 'fields' },
    })
  }
  const todayPending = s.tasks.filter((t) => !t.done && t.due === 'আজ')
  if (todayPending.length > 0) {
    recs.push({
      id: 'tasks',
      text: t('recs.tasksPending', { n: bn(todayPending.length) }),
      tone: 'neutral',
      action: { label: t('recs.seeTasks'), view: 'tasks' },
    })
  }
  const low = s.stock.filter(isLowStock)
  if (low.length > 0) {
    recs.push({
      id: 'stock',
      text: t('recs.stockLow', { n: bn(low.length), names: low.map((x) => x.name).join(', ') }),
      tone: 'warn',
      action: { label: t('recs.seeStock'), view: 'inventory' },
    })
  }
  s.fields
    .filter((f) => f.age < f.harvestAt && f.harvestAt - f.age <= 7)
    .forEach((f) =>
      recs.push({
        id: `harvest-${f.id}`,
        text: t('recs.harvestSoon', { name: f.name, n: bn(f.harvestAt - f.age) }),
        tone: 'info',
      }),
    )
  if (recs.length === 0) {
    recs.push({ id: 'ok', text: t('recs.allOk'), tone: 'ok' })
  }
  return recs
}

/** The coarse label for a deadline, by calendar days from now (the server derives the same for live tasks). */
export function dueFor(dueAt: number, now: number = Date.now()): Due {
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0)
  const days = Math.round((day(dueAt) - day(now)) / 86_400_000)
  if (days <= 0) return 'আজ'
  if (days === 1) return 'কাল'
  return days <= 7 ? 'এই সপ্তাহ' : 'পরে'
}

/** An open task whose deadline has passed. */
export const isOverdue = (t: { done: boolean; dueAt?: number }, now: number = Date.now()) =>
  !t.done && !!t.dueAt && t.dueAt < now

/** 23:59 local, `days` days from today — a picked deadline means "by the end of that day". */
export function endOfDayIn(days: number, now: number = Date.now()): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 23, 59, 0, 0).getTime()
}
