import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFarm } from '@/atoms/farm'
import type { LedgerEntry } from '@/types'
import i18n from '@/i18n'
import { http } from './http'
import { useList, useMutate } from './source'

export function useLedger() {
  return useList<LedgerEntry>('ledger', '/ledger', (s) => s.ledger)
}

export function useAddLedger() {
  const addLedger = useFarm((s) => s.addLedger)
  return useMutate<Omit<LedgerEntry, 'id' | 'at'>>(
    'ledger',
    (x) => addLedger(x),
    (x) => http.post('/ledger', x),
    i18n.t('toasts.ledgerAdded'),
  )
}

export function useDeleteLedger() {
  const deleteLedger = useFarm((s) => s.deleteLedger)
  return useMutate<LedgerEntry>(
    'ledger',
    (l) => deleteLedger(l.id),
    (l) => http.delete(`/ledger/${l.id}`),
  )
}

/** Whole-ledger totals: SQL on the server (GET /reports/ledger-summary), derived from the demo ledger while simulating. */
export interface LedgerSummary {
  income: number
  expense: number
  expenseByCat: Record<string, number>
}

interface ServerLedgerSummary {
  income: number
  expense: number
  byCategory: { type: 'income' | 'expense'; cat: string; total: number }[]
}

export function useLedgerSummary(): LedgerSummary {
  const simulate = useFarm((s) => s.simulate)
  const demo = useFarm((s) => s.ledger)
  const query = useQuery({
    queryKey: ['ledger', 'summary'], // shares the 'ledger' prefix, so ledger mutations refresh it
    queryFn: () => http.get<ServerLedgerSummary>('/reports/ledger-summary'),
    enabled: !simulate,
  })
  return useMemo(() => {
    const expenseByCat: Record<string, number> = {}
    if (simulate || !query.data) {
      let income = 0
      let expense = 0
      for (const l of simulate ? demo : []) {
        if (l.type === 'income') income += l.amount
        else {
          expense += l.amount
          expenseByCat[l.cat] = (expenseByCat[l.cat] ?? 0) + l.amount
        }
      }
      return { income, expense, expenseByCat }
    }
    for (const r of query.data.byCategory) if (r.type === 'expense') expenseByCat[r.cat] = r.total
    return { income: query.data.income, expense: query.data.expense, expenseByCat }
  }, [simulate, demo, query.data])
}
