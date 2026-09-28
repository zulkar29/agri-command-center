import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useFarm } from '@/atoms/farm'
import type { Field, Page, Task } from '@/types'
import { http } from './http'
import { buildQS, type QueryParams } from './source'

export interface Reason {
  factor: 'season' | 'rotation' | 'water' | 'market'
  /** 0..1 */
  score: number
  text: string
}

export interface Suggestion {
  cropId: string
  crop: string
  /** 0..100 */
  score: number
  /** strongest contribution first */
  reasons: Reason[]
}

export interface MarketPrice {
  id: string
  crop: string
  /** epoch ms */
  at: number
  pricePerKg: number
  market: string
}

function useLive() {
  return !useFarm((s) => s.simulate)
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed'))

export function useRecommendations(fieldId: string, enabled: boolean) {
  const live = useLive()
  return useQuery({
    queryKey: ['recommendations', fieldId],
    queryFn: () => http.get<{ items: Suggestion[] }>(`/fields/${fieldId}/recommendations`).then((r) => r.items),
    enabled: live && enabled,
    retry: false,
  })
}

export function usePlantTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (x: { templateId: string; fieldId: string }) =>
      http.post<{ field: Field; tasks: Task[] }>(`/crop-templates/${x.templateId}/applications`, { fieldId: x.fieldId }),
    onSuccess: (r) => {
      toast.success(i18n.t('advice.planted', { crop: r.field.crop, n: r.tasks.length }))
      for (const key of ['fields', 'tasks', 'recommendations']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: fail,
  })
}

export function useMarketPrices(params?: QueryParams) {
  const live = useLive()
  return useQuery({
    queryKey: ['market-prices', params],
    queryFn: () => http.get<Page<MarketPrice>>(`/market-prices${buildQS({ limit: 30, ...params })}`).then((p) => p.items),
    enabled: live,
    retry: false,
  })
}

export function useAddMarketPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (x: { crop: string; pricePerKg: number; market?: string }) => http.post<MarketPrice>('/market-prices', x),
    onSuccess: () => {
      toast.success(i18n.t('advice.priceSaved'))
      for (const key of ['market-prices', 'recommendations']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: fail,
  })
}

export function useDeleteMarketPrice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => http.delete(`/market-prices/${id}`),
    onSuccess: () => {
      for (const key of ['market-prices', 'recommendations']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: fail,
  })
}
