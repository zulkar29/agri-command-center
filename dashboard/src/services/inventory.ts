import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFarm } from '@/atoms/farm'
import type { LedgerEntry, StockItem } from '@/types'
import i18n from '@/i18n'
import { http } from './http'
import { useList, useMutate } from './source'

export function useStock() {
  return useList<StockItem>('stock', '/stock', (s) => s.stock)
}

/** Adjust qty with a +/- delta (like the inventory page's stepper buttons). */
export function useAdjustStock() {
  const adjustStock = useFarm((s) => s.adjustStock)
  return useMutate<{ id: string; delta: number }>(
    'stock',
    (x) => adjustStock(x.id, x.delta),
    (x) => http.patch(`/stock/${x.id}`, { delta: x.delta }),
  )
}

export function useAddStock() {
  const addStock = useFarm((s) => s.addStock)
  return useMutate<Omit<StockItem, 'id'>>(
    'stock',
    (x) => addStock(x),
    (x) => http.post('/stock', x),
    i18n.t('toasts.stockAdded'),
  )
}

export function useDeleteStock() {
  const deleteStock = useFarm((s) => s.deleteStock)
  return useMutate<StockItem>('stock', (x) => deleteStock(x.id), (x) => http.delete(`/stock/${x.id}`))
}

export interface StockUse {
  id: string
  qty: number
  fieldId?: string
  /** ৳; books an expense in the ledger (owner only) */
  cost?: number
  cat?: string
}

/** Record using some of an item: stock goes down, a cost becomes a ledger expense for the field. */
export function useUseStock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: StockUse) =>
      http.post<{ item: StockItem; ledger: LedgerEntry | null }>(`/stock/${id}/usages`, body),
    onSuccess: (r) => {
      toast.success(i18n.t('inventory.used', { name: r.item.name }))
      // a cost also changes the ledger and the per-field profit (both share the 'ledger' prefix)
      for (const key of ['stock', 'ledger']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}
