import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFarm } from '@/atoms/farm'
import { financeFromLedger, periodRange, type Finance, type Period, type Range, type ReportInput } from '@/lib/report'
import { useFarmAlerts } from './alerts'
import { useFields, useObservations } from './fields'
import { useHarvests } from './harvest'
import { http } from './http'
import { useStock } from './inventory'
import { useTasks } from './tasks'

/**
 * Server-computed read-only views under /reports (backend: ledger.go, water.go).
 * Live-only: the numbers come from SQL over the whole history.
 */
export interface FieldProfit {
  /** '' = ledger entries with no field tag */
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

export interface WeeklySummary {
  from: number
  to: number
  litres: number
  pumpRuns: number
  income: number
  expense: number
  harvestKg: number
  openTasks: number
  overdueTasks: number
  lowStock: string[]
  activeAlerts: number
  /** false → litres show 0 because the pump flow was never set */
  pumpFlowKnown: boolean
}

export function useFieldProfit() {
  const live = !useFarm((s) => s.simulate)
  return useQuery({
    queryKey: ['ledger', 'field-profit'], // shares the 'ledger' prefix, so ledger mutations refresh it
    queryFn: () => http.get<{ items: FieldProfit[] }>('/reports/field-profit').then((r) => r.items),
    enabled: live,
    retry: false,
  })
}

export function useWeeklySummary() {
  const live = !useFarm((s) => s.simulate)
  return useQuery({
    queryKey: ['weekly-summary'],
    queryFn: () => http.get<WeeklySummary>('/reports/weekly-summary'),
    enabled: live,
    retry: false,
    refetchInterval: 5 * 60_000,
  })
}

/** A reporting period, epoch ms. */
export interface TimeRange {
  from: number
  to: number
}

export interface RangeSummary {
  income: number
  expense: number
  byCategory: { type: 'income' | 'expense'; cat: string; total: number }[]
}

/** Income/expense totals per category for one period (SQL on the server, exact beyond the list page). */
export function useLedgerRange(range: TimeRange) {
  const live = !useFarm((s) => s.simulate)
  return useQuery({
    queryKey: ['ledger', 'report-summary', range],
    queryFn: () => http.get<RangeSummary>(`/reports/ledger-summary?from=${range.from}&to=${range.to}`),
    enabled: live,
    retry: false,
  })
}

/** Profit per field for one period. */
export function useFieldProfitRange(range: TimeRange) {
  const live = !useFarm((s) => s.simulate)
  return useQuery({
    queryKey: ['ledger', 'report-field-profit', range],
    queryFn: () => http.get<{ items: FieldProfit[] }>(`/reports/field-profit?from=${range.from}&to=${range.to}`).then((r) => r.items),
    enabled: live,
    retry: false,
  })
}

/**
 * Everything a report needs for one period. Live: the money comes from the
 * server's SQL reports (exact beyond the 200-row list page); demo: it is
 * derived from the demo ledger. The "now" of a report is fixed when the page
 * opens, so the numbers do not shift while it is on screen.
 */
export function useReportData(period: Period): { input: ReportInput; loading: boolean } {
  const simulate = useFarm((s) => s.simulate)
  const demoLedger = useFarm((s) => s.ledger)
  const [now] = useState(() => Date.now())
  const range = useMemo<Range>(() => periodRange(period, now), [period, now])

  const fields = useFields()
  const tasks = useTasks()
  const stock = useStock()
  const observations = useObservations()
  const { items: alerts } = useFarmAlerts()
  const harvests = useHarvests().data

  const summary = useLedgerRange(range)
  const perField = useFieldProfitRange(range)

  const finance = useMemo<Finance>(() => {
    if (simulate) return financeFromLedger(demoLedger, fields, range)
    const incomeByCat: Record<string, number> = {}
    const expenseByCat: Record<string, number> = {}
    for (const r of summary.data?.byCategory ?? []) (r.type === 'income' ? incomeByCat : expenseByCat)[r.cat] = r.total
    return {
      income: summary.data?.income ?? 0,
      expense: summary.data?.expense ?? 0,
      incomeByCat,
      expenseByCat,
      perField: perField.data ?? [],
    }
  }, [simulate, demoLedger, fields, range, summary.data, perField.data])

  const input = useMemo<ReportInput>(
    () => ({ now, range, finance, fields, observations, tasks, stock, alerts, harvests }),
    [now, range, finance, fields, observations, tasks, stock, alerts, harvests],
  )
  return { input, loading: !simulate && (summary.isPending || perField.isPending) }
}
