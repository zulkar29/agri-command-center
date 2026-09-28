import i18n from '@/i18n'
import { bn, fmt } from '@/lib/format'
import { catLabel } from '@/lib/labels'
import { isLowStock, isOverdue } from '@/lib/farm'
import type { Tone } from '@/lib/tone'
import type { Field, LedgerEntry, Observation, StockItem, Task } from '@/types'

/**
 * Pure report builders (docs/04): the data is gathered by useReportData (services/reports.ts),
 * these functions turn it into the sections the printable report shows.
 * Nothing here touches the network, the store or the DOM, so it is unit-tested.
 */

const t = i18n.t.bind(i18n)
const DAY = 86_400_000

export type Period = 'month' | '30d' | '90d' | 'year' | 'all'
export const PERIODS: Period[] = ['month', '30d', '90d', 'year', 'all']
export type ReportKind = 'full' | 'pnl' | 'actions' | 'lessons'
export const REPORT_KINDS: ReportKind[] = ['full', 'pnl', 'actions', 'lessons']

export interface Range {
  from: number
  to: number
}

/** Start/end (epoch ms) of a reporting period; 'all' starts at 0. */
export function periodRange(p: Period, now: number = Date.now()): Range {
  switch (p) {
    case 'month': {
      const d = new Date(now)
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now }
    }
    case '30d':
      return { from: now - 30 * DAY, to: now }
    case '90d':
      return { from: now - 90 * DAY, to: now }
    case 'year':
      return { from: now - 365 * DAY, to: now }
    default:
      return { from: 0, to: now }
  }
}

export interface FieldMoney {
  /** '' = entries with no field tag */
  fieldId: string
  name: string
  crop: string
  area: number
  income: number
  expense: number
  profit: number
  /** profit per শতক; null without an area */
  profitPerShotok: number | null
}

export interface Finance {
  income: number
  expense: number
  incomeByCat: Record<string, number>
  expenseByCat: Record<string, number>
  perField: FieldMoney[]
}

/** The ledger entries of a range, grouped the way the server's report endpoints do — for demo mode. */
export function financeFromLedger(ledger: LedgerEntry[], fields: Field[], r: Range): Finance {
  const out: Finance = { income: 0, expense: 0, incomeByCat: {}, expenseByCat: {}, perField: [] }
  const rows = new Map<string, FieldMoney>()
  for (const f of fields) {
    rows.set(f.id, { fieldId: f.id, name: f.name, crop: f.crop, area: f.area, income: 0, expense: 0, profit: 0, profitPerShotok: null })
  }
  const untagged: FieldMoney = { fieldId: '', name: '', crop: '', area: 0, income: 0, expense: 0, profit: 0, profitPerShotok: null }
  for (const l of ledger) {
    if (l.at < r.from || l.at > r.to) continue
    const byCat = l.type === 'income' ? out.incomeByCat : out.expenseByCat
    byCat[l.cat] = (byCat[l.cat] ?? 0) + l.amount
    const row = (l.fieldId && rows.get(l.fieldId)) || untagged
    if (l.type === 'income') {
      out.income += l.amount
      row.income += l.amount
    } else {
      out.expense += l.amount
      row.expense += l.amount
    }
  }
  out.perField = [...rows.values(), untagged]
    .filter((x) => x.fieldId !== '' || x.income > 0 || x.expense > 0)
    .map((x) => ({ ...x, profit: x.income - x.expense, profitPerShotok: x.area > 0 ? (x.income - x.expense) / x.area : null }))
  return out
}

export interface CatShare {
  cat: string
  amount: number
  /** 0-100 of the total */
  pct: number
}

/** Largest first, each with its share of the total. */
export function catShares(byCat: Record<string, number>): CatShare[] {
  const total = Object.values(byCat).reduce((a, b) => a + b, 0)
  return Object.entries(byCat)
    .map(([cat, amount]) => ({ cat, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount)
}

export interface Pnl {
  income: number
  expense: number
  profit: number
  /** profit as % of income; null without income */
  margin: number | null
  expenseShares: CatShare[]
  incomeShares: CatShare[]
  /** fields that have entries, best profit first; the untagged row (fieldId '') last */
  fields: FieldMoney[]
}

export function buildPnl(f: Finance): Pnl {
  const profit = f.income - f.expense
  const tagged = f.perField.filter((x) => x.fieldId !== '' && (x.income > 0 || x.expense > 0)).sort((a, b) => b.profit - a.profit)
  const untagged = f.perField.filter((x) => x.fieldId === '')
  return {
    income: f.income,
    expense: f.expense,
    profit,
    margin: f.income > 0 ? Math.round((profit / f.income) * 100) : null,
    expenseShares: catShares(f.expenseByCat),
    incomeShares: catShares(f.incomeByCat),
    fields: [...tagged, ...untagged],
  }
}

export interface HarvestLite {
  fieldId: string
  at: number
  kg: number
  pricePerKg: number
}

export interface ReportInput {
  now: number
  range: Range
  finance: Finance
  fields: Field[]
  observations: Observation[]
  tasks: Task[]
  stock: StockItem[]
  /** the alerts that are still open */
  alerts: { id: string; title: string; detail: string; tone: Tone }[]
  /** live mode only — undefined in demo mode */
  harvests?: HarvestLite[]
}

export interface ActionItem {
  id: string
  tone: Tone
  /** short area tag shown in front, e.g. "Tasks" */
  area: string
  text: string
}

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, neutral: 4 }

/** Next action points: what needs doing, most urgent first. */
export function buildActions(i: ReportInput): ActionItem[] {
  const out: ActionItem[] = []
  const fieldName = (id?: string) => i.fields.find((f) => f.id === id)?.name

  for (const a of i.alerts) {
    out.push({ id: `alert-${a.id}`, tone: a.tone === 'bad' ? 'bad' : 'warn', area: t('reports.area.alerts'), text: `${a.title} — ${a.detail}` })
  }

  const open = i.tasks.filter((x) => !x.done)
  for (const x of open.filter((x) => isOverdue(x, i.now))) {
    out.push({ id: `late-${x.id}`, tone: 'bad', area: t('reports.area.tasks'), text: t('reports.act.overdue', { text: x.text }) })
  }
  for (const x of open.filter((x) => !isOverdue(x, i.now) && (x.urgent || x.due === 'আজ'))) {
    out.push({ id: `task-${x.id}`, tone: x.urgent ? 'warn' : 'info', area: t('reports.area.tasks'), text: x.text })
  }

  const low = i.stock.filter(isLowStock)
  for (const s of low) {
    out.push({
      id: `stock-${s.id}`,
      tone: 'warn',
      area: t('reports.area.stock'),
      text: t('reports.act.buy', { name: s.name, qty: bn(s.qty), min: bn(s.min), unit: s.unit }),
    })
  }

  for (const f of i.fields) {
    const left = f.harvestAt - f.age
    if (left <= 0) out.push({ id: `harvest-${f.id}`, tone: 'ok', area: t('reports.area.fields'), text: t('reports.act.harvestNow', { name: f.name }) })
    else if (left <= 7) out.push({ id: `harvest-${f.id}`, tone: 'info', area: t('reports.area.fields'), text: t('reports.act.harvestSoon', { name: f.name, n: bn(left), count: left }) })
  }

  // a pest/disease note in the last two weeks → look at that field again
  const recent = i.observations.filter((o) => o.kind !== 'ঠিক আছে' && i.now - o.at <= 14 * DAY)
  const seen = new Set<string>()
  for (const o of recent) {
    const key = o.fieldId ?? ''
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `scout-${key || o.id}`,
      tone: 'warn',
      area: t('reports.area.fields'),
      text: t('reports.act.recheck', { field: fieldName(o.fieldId) ?? t('reports.thefarm'), kind: t(`obsKind.${o.kind}`, { defaultValue: o.kind }) }),
    })
  }

  for (const f of buildPnl(i.finance).fields) {
    // a crop that has not reached harvest yet has costs and no sales by design
    const fld = i.fields.find((x) => x.id === f.fieldId)
    if (f.fieldId && f.profit < 0 && (f.income > 0 || (fld && fld.age >= fld.harvestAt))) {
      out.push({ id: `loss-${f.fieldId}`, tone: 'warn', area: t('reports.area.money'), text: t('reports.act.lossField', { name: f.name, v: fmt(Math.abs(f.profit)) }) })
    }
  }
  if (i.finance.expense > 0 && i.finance.income === 0) {
    out.push({ id: 'no-income', tone: 'info', area: t('reports.area.money'), text: t('reports.act.noIncome') })
  }

  return out.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
}

export interface Lesson {
  id: string
  tone: Tone
  title: string
  detail: string
}

/**
 * Lessons the data itself teaches. They are plain rules of thumb over the
 * numbers (best/worst field, biggest cost, pest history) — a prompt for the
 * farmer's own judgement, not an agronomist's verdict.
 */
export function buildLessons(i: ReportInput): Lesson[] {
  const out: Lesson[] = []
  const pnl = buildPnl(i.finance)

  if (pnl.income > 0 || pnl.expense > 0) {
    out.push(
      pnl.profit >= 0
        ? { id: 'result', tone: 'ok', title: t('reports.les.profitTitle', { v: fmt(pnl.profit) }), detail: pnl.margin != null ? t('reports.les.marginDetail', { n: bn(pnl.margin) }) : t('reports.les.noSalesDetail') }
        : { id: 'result', tone: 'bad', title: t('reports.les.lossTitle', { v: fmt(Math.abs(pnl.profit)) }), detail: t('reports.les.lossDetail') },
    )
  }

  const top = pnl.expenseShares[0]
  if (top && top.pct >= 40) {
    out.push({ id: 'top-cost', tone: 'warn', title: t('reports.les.topCostTitle', { cat: catLabel(top.cat), n: bn(top.pct) }), detail: t('reports.les.topCostDetail', { v: fmt(top.amount) }) })
  }

  // compare only fields that have had their chance to earn: sold something or reached harvest age
  const ranked = pnl.fields.filter((x) => {
    const fld = i.fields.find((f) => f.id === x.fieldId)
    return x.fieldId !== '' && (x.income > 0 || (x.expense > 0 && fld && fld.age >= fld.harvestAt))
  })
  if (ranked.length >= 2) {
    const best = ranked[0]
    const worst = ranked[ranked.length - 1]
    if (best.fieldId !== worst.fieldId) {
      out.push({
        id: 'best-field',
        tone: 'ok',
        title: t('reports.les.bestFieldTitle', { name: best.name, crop: best.crop }),
        detail: t('reports.les.bestFieldDetail', { v: money(best.profit) }),
      })
      if (worst.profit < best.profit) {
        out.push({
          id: 'worst-field',
          tone: worst.profit < 0 ? 'bad' : 'warn',
          title: t('reports.les.worstFieldTitle', { name: worst.name, crop: worst.crop }),
          detail: t('reports.les.worstFieldDetail', { v: money(worst.profit) }),
        })
      }
    }
  }

  const untagged = pnl.fields.find((x) => x.fieldId === '')
  const entryTotal = pnl.income + pnl.expense
  if (untagged && entryTotal > 0 && (untagged.income + untagged.expense) / entryTotal > 0.3) {
    out.push({ id: 'untagged', tone: 'info', title: t('reports.les.untaggedTitle'), detail: t('reports.les.untaggedDetail', { n: bn(Math.round(((untagged.income + untagged.expense) / entryTotal) * 100)) }) })
  }

  const inRange = i.observations.filter((o) => o.at >= i.range.from && o.at <= i.range.to)
  const issues = inRange.filter((o) => o.kind !== 'ঠিক আছে')
  if (issues.length > 0) {
    const perField = new Map<string, number>()
    for (const o of issues) perField.set(o.fieldId ?? '', (perField.get(o.fieldId ?? '') ?? 0) + 1)
    const [worstId, n] = [...perField.entries()].sort((a, b) => b[1] - a[1])[0]
    const name = i.fields.find((f) => f.id === worstId)?.name
    const pests = issues.filter((o) => o.kind === 'পোকা').length
    out.push({
      id: 'scouting',
      tone: 'warn',
      title: t('reports.les.scoutTitle', { n: bn(issues.length), pests: bn(pests), diseases: bn(issues.length - pests) }),
      detail: name ? t('reports.les.scoutDetail', { name, n: bn(n) }) : t('reports.les.scoutDetailAny'),
    })
  } else if (inRange.length > 0) {
    out.push({ id: 'scouting', tone: 'ok', title: t('reports.les.cleanTitle', { n: bn(inRange.length) }), detail: t('reports.les.cleanDetail') })
  }

  const hv = (i.harvests ?? []).filter((h) => h.at >= i.range.from && h.at <= i.range.to)
  const kg = hv.reduce((a, h) => a + h.kg, 0)
  if (kg > 0) {
    const priced = hv.filter((h) => h.pricePerKg > 0)
    const avg = priced.length ? priced.reduce((a, h) => a + h.pricePerKg * h.kg, 0) / priced.reduce((a, h) => a + h.kg, 0) : 0
    const cost = pnl.expense / kg
    out.push({
      id: 'harvest',
      tone: avg > 0 && cost > avg ? 'bad' : 'info',
      title: t('reports.les.harvestTitle', { kg: bn(Math.round(kg)), cost: bn(cost.toFixed(1)) }),
      detail: avg > 0 ? t('reports.les.harvestDetail', { avg: bn(avg.toFixed(1)) }) : t('reports.les.harvestNoPrice'),
    })
  }

  return out
}

/** ৳ with a leading minus for losses. */
export function money(v: number): string {
  return `${v < 0 ? '−' : ''}৳ ${fmt(Math.abs(Math.round(v)))}`
}

/** Suggested file / window name, e.g. "profit-loss-2026-10-08". */
export function reportFileName(kind: ReportKind, now: number = Date.now()): string {
  const slug: Record<ReportKind, string> = { full: 'farm-report', pnl: 'profit-loss', actions: 'action-plan', lessons: 'lessons-learned' }
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${slug[kind]}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
