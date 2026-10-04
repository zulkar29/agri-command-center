import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { demoAtom } from '@/state/conn'
import { http } from './http'

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
  const live = !useAtomValue(demoAtom)
  return useQuery({
    queryKey: ['ledger', 'field-profit'], // shares the 'ledger' prefix, so ledger mutations refresh it
    queryFn: () => http.get<{ items: FieldProfit[] }>('/reports/field-profit').then((r) => r.items),
    enabled: live,
    retry: false,
  })
}

export function useWeeklySummary() {
  const live = !useAtomValue(demoAtom)
  return useQuery({
    queryKey: ['weekly-summary'],
    queryFn: () => http.get<WeeklySummary>('/reports/weekly-summary'),
    enabled: live,
    retry: false,
    refetchInterval: 5 * 60_000,
  })
}
