import { describe, expect, it } from 'vitest'
import { buildActions, buildLessons, buildPnl, catShares, financeFromLedger, periodRange, reportFileName, type ReportInput } from '@/lib/report'
import type { Field, LedgerEntry, Observation, StockItem, Task } from '@/types'

const NOW = new Date(2026, 9, 8, 12).getTime() // 8 Oct 2026
const DAY = 86_400_000

const field = (id: string, over: Partial<Field> = {}): Field => ({ id, name: id, crop: 'টমেটো', area: 10, plants: 100, age: 20, harvestAt: 60, ...over })
const entry = (type: 'income' | 'expense', cat: string, amount: number, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `${type}${cat}${amount}`,
  at: NOW - DAY,
  type,
  cat,
  amount,
  note: '',
  ...over,
})

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  now: NOW,
  range: periodRange('30d', NOW),
  finance: { income: 0, expense: 0, incomeByCat: {}, expenseByCat: {}, perField: [] },
  fields: [],
  observations: [],
  tasks: [],
  stock: [],
  alerts: [],
  ...over,
})

describe('periodRange', () => {
  it('starts the month on the 1st', () => {
    expect(new Date(periodRange('month', NOW).from).getDate()).toBe(1)
  })
  it('counts back whole days', () => {
    expect(periodRange('90d', NOW).from).toBe(NOW - 90 * DAY)
  })
  it('"all" starts at zero', () => {
    expect(periodRange('all', NOW).from).toBe(0)
  })
})

describe('financeFromLedger', () => {
  const fields = [field('f1'), field('f2', { area: 0 })]
  const ledger = [
    entry('income', 'ফসল বিক্রি', 5000, { fieldId: 'f1' }),
    entry('expense', 'সার', 1500, { fieldId: 'f1' }),
    entry('expense', 'শ্রম', 700, { fieldId: 'f2' }),
    entry('expense', 'সরঞ্জাম', 300),
    entry('expense', 'সার', 99999, { at: NOW - 400 * DAY }), // outside the range
  ]
  const fin = financeFromLedger(ledger, fields, periodRange('90d', NOW))

  it('totals only the entries inside the range', () => {
    expect(fin.income).toBe(5000)
    expect(fin.expense).toBe(2500)
    expect(fin.expenseByCat['সার']).toBe(1500)
  })
  it('splits per field and keeps untagged entries on their own row', () => {
    const f1 = fin.perField.find((x) => x.fieldId === 'f1')!
    expect(f1.profit).toBe(3500)
    expect(f1.profitPerShotok).toBe(350)
    expect(fin.perField.find((x) => x.fieldId === '')?.expense).toBe(300)
  })
  it('gives no per-shotok figure for a field without an area', () => {
    expect(fin.perField.find((x) => x.fieldId === 'f2')?.profitPerShotok).toBeNull()
  })
  it('drops the untagged row when nothing is untagged', () => {
    expect(financeFromLedger([entry('income', 'ফসল বিক্রি', 1, { fieldId: 'f1' })], fields, periodRange('all', NOW)).perField.some((x) => x.fieldId === '')).toBe(false)
  })
})

describe('buildPnl', () => {
  it('computes profit and margin, best field first, untagged last', () => {
    const fin = financeFromLedger(
      [entry('income', 'ফসল বিক্রি', 1000, { fieldId: 'b' }), entry('expense', 'সার', 400, { fieldId: 'a' }), entry('expense', 'সার', 100)],
      [field('a'), field('b')],
      periodRange('all', NOW),
    )
    const p = buildPnl(fin)
    expect(p.profit).toBe(500)
    expect(p.margin).toBe(50)
    expect(p.fields.map((x) => x.fieldId)).toEqual(['b', 'a', ''])
  })
  it('has no margin without income', () => {
    expect(buildPnl(input().finance).margin).toBeNull()
  })
})

describe('catShares', () => {
  it('orders largest first and sums to the total share', () => {
    const s = catShares({ সার: 300, শ্রম: 700 })
    expect(s[0]).toMatchObject({ cat: 'শ্রম', pct: 70 })
    expect(s[1].pct).toBe(30)
  })
  it('handles an empty map', () => {
    expect(catShares({})).toEqual([])
  })
})

describe('buildActions', () => {
  const task = (over: Partial<Task>): Task => ({ id: 't', text: 'x', who: 'আমি', due: 'পরে', urgent: false, done: false, ...over })
  const stock: StockItem = { id: 's1', name: 'ইউরিয়া', unit: 'কেজি', qty: 2, min: 5 }

  it('lists overdue tasks, low stock, harvest due and open alerts, urgent first', () => {
    const a = buildActions(
      input({
        tasks: [task({ id: 'late', dueAt: NOW - DAY }), task({ id: 'done', done: true, dueAt: NOW - DAY })],
        stock: [stock],
        fields: [field('f1', { age: 59, harvestAt: 60 })],
        alerts: [{ id: 'dry', title: 'dry', detail: 'd', tone: 'bad' }],
      }),
    )
    const ids = a.map((x) => x.id)
    expect(ids).toContain('late-late')
    expect(ids).not.toContain('late-done')
    expect(ids).toContain('stock-s1')
    expect(ids).toContain('harvest-f1')
    expect(a[0].tone).toBe('bad')
    expect(a.map((x) => x.tone)).toEqual([...a.map((x) => x.tone)].sort((x, y) => ['bad', 'warn', 'info', 'ok', 'neutral'].indexOf(x) - ['bad', 'warn', 'info', 'ok', 'neutral'].indexOf(y)))
  })
  it('asks to re-check a field with a recent pest note, once per field', () => {
    const obs = (id: string, at: number): Observation => ({ id, at, kind: 'পোকা', note: '', fieldId: 'f1' })
    const a = buildActions(input({ fields: [field('f1')], observations: [obs('o1', NOW - DAY), obs('o2', NOW - 2 * DAY), obs('old', NOW - 30 * DAY)] }))
    expect(a.filter((x) => x.id.startsWith('scout-'))).toHaveLength(1)
  })
  it('flags a field that sold but still lost money, or one past harvest with no sales', () => {
    const sold = financeFromLedger([entry('expense', 'সার', 900, { fieldId: 'f1' }), entry('income', 'ফসল বিক্রি', 100, { fieldId: 'f1' })], [field('f1')], periodRange('all', NOW))
    expect(buildActions(input({ finance: sold, fields: [field('f1')] })).some((x) => x.id === 'loss-f1')).toBe(true)
    const late = financeFromLedger([entry('expense', 'সার', 900, { fieldId: 'f1' })], [field('f1', { age: 70 })], periodRange('all', NOW))
    expect(buildActions(input({ finance: late, fields: [field('f1', { age: 70 })] })).some((x) => x.id === 'loss-f1')).toBe(true)
  })
  it('does not call a young crop with costs and no sales a loss', () => {
    const fin = financeFromLedger([entry('expense', 'সার', 900, { fieldId: 'f1' })], [field('f1')], periodRange('all', NOW))
    expect(buildActions(input({ finance: fin, fields: [field('f1')] })).some((x) => x.id === 'loss-f1')).toBe(false)
  })
  it('is empty when nothing is pending', () => {
    expect(buildActions(input())).toEqual([])
  })
})

describe('buildLessons', () => {
  it('is empty without any records', () => {
    expect(buildLessons(input())).toEqual([])
  })
  it('names the best and the weakest field and a dominant cost', () => {
    const fin = financeFromLedger(
      [entry('income', 'ফসল বিক্রি', 5000, { fieldId: 'good' }), entry('expense', 'সার', 3000, { fieldId: 'bad' }), entry('expense', 'শ্রম', 500, { fieldId: 'good' })],
      [field('good'), field('bad', { age: 70 })],
      periodRange('all', NOW),
    )
    const l = buildLessons(input({ finance: fin, fields: [field('good'), field('bad', { age: 70 })] }))
    const ids = l.map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['result', 'top-cost', 'best-field', 'worst-field']))
    expect(l.find((x) => x.id === 'worst-field')?.tone).toBe('bad')
  })
  it('only compares fields when there are at least two', () => {
    const fin = financeFromLedger([entry('income', 'ফসল বিক্রি', 100, { fieldId: 'only' })], [field('only')], periodRange('all', NOW))
    expect(buildLessons(input({ finance: fin, fields: [field('only')] })).some((x) => x.id === 'best-field')).toBe(false)
  })
  it('counts pests and diseases noted in the period', () => {
    const obs: Observation[] = [
      { id: '1', at: NOW - DAY, kind: 'পোকা', note: '', fieldId: 'f1' },
      { id: '2', at: NOW - DAY, kind: 'রোগ', note: '', fieldId: 'f1' },
      { id: '3', at: NOW - 100 * DAY, kind: 'রোগ', note: '' }, // before the 30-day range
    ]
    const scout = buildLessons(input({ observations: obs, fields: [field('f1')] })).find((x) => x.id === 'scouting')
    expect(scout?.tone).toBe('warn')
  })
  it('compares cost per kg with the selling price when harvests are known', () => {
    const fin = { ...input().finance, expense: 1000 }
    const l = buildLessons(input({ finance: fin, harvests: [{ fieldId: 'f1', at: NOW - DAY, kg: 100, pricePerKg: 8 }] }))
    expect(l.find((x) => x.id === 'harvest')?.tone).toBe('bad') // 10 ৳/kg cost > 8 ৳/kg price
  })
})

describe('reportFileName', () => {
  it('is dated and per kind', () => {
    expect(reportFileName('pnl', NOW)).toBe('profit-loss-2026-10-08')
  })
})
