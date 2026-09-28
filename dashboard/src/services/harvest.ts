import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useFarm } from '@/atoms/farm'
import type { Page } from '@/types'
import { http } from './http'
import { buildQS, type QueryParams } from './source'

/**
 * Harvest records and the water account (backend: internal/api/harvests.go, water.go).
 * Live-only: the demo store has no pump-flow or harvest history, so these
 * hooks stay disabled while নমুনা মোড is on.
 */
export interface Harvest {
  id: string
  fieldId: string
  /** epoch ms */
  at: number
  kg: number
  grade: string
  pricePerKg: number
  note: string
}

export interface NewHarvest {
  fieldId: string
  kg: number
  grade?: string
  pricePerKg?: number
  note?: string
  /** also book kg × price as a ledger income (owner only) */
  addIncome?: boolean
}

export interface WaterSummary {
  days: number
  runs: number
  litres: number
  /** litres per zone index */
  perZone: number[]
  perDay: { day: string; litres: number }[]
  pumpFlowLpm: number
}

export interface FieldEfficiency {
  fieldId: string
  name: string
  crop: string
  zone?: number
  litres: number
  kg: number
  litresPerKg: number | null
  revenue: number
}

export const harvestService = {
  list: (params?: QueryParams) => http.get<Page<Harvest>>(`/harvests${buildQS(params)}`),
  create: (h: NewHarvest) => http.post<Harvest>('/harvests', h),
  remove: (id: string) => http.delete(`/harvests/${id}`),
  waterSummary: (days: number) => http.get<WaterSummary>(`/reports/water-use?days=${days}`),
  efficiency: (days: number) => http.get<{ days: number; items: FieldEfficiency[] }>(`/reports/field-efficiency?days=${days}`),
  setPumpFlow: (pumpFlowLpm: number) => http.patch('/farm', { pumpFlowLpm }),
}

function useLive() {
  return !useFarm((s) => s.simulate)
}

export function useHarvests(fieldId?: string) {
  const live = useLive()
  return useQuery({
    queryKey: ['harvests', fieldId],
    queryFn: () => harvestService.list({ limit: 100, field: fieldId }).then((p) => p.items),
    enabled: live,
    retry: false,
  })
}

export function useWaterSummary(days = 30) {
  const live = useLive()
  return useQuery({
    queryKey: ['water-summary', days],
    queryFn: () => harvestService.waterSummary(days),
    enabled: live,
    retry: false,
    refetchInterval: 60_000,
  })
}

export function useEfficiency(days = 365) {
  const live = useLive()
  return useQuery({
    queryKey: ['efficiency', days],
    queryFn: () => harvestService.efficiency(days).then((r) => r.items),
    enabled: live,
    retry: false,
  })
}

export function useAddHarvest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (h: NewHarvest) => harvestService.create(h),
    onSuccess: (_d, h) => {
      toast.success(i18n.t('harvest.saved'))
      for (const key of ['harvests', 'efficiency', 'weekly-summary']) void qc.invalidateQueries({ queryKey: [key] })
      if (h.addIncome) void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useDeleteHarvest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => harvestService.remove(id),
    onSuccess: () => {
      for (const key of ['harvests', 'efficiency', 'weekly-summary']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useSetPumpFlow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lpm: number) => harvestService.setPumpFlow(lpm),
    onSuccess: () => {
      toast.success(i18n.t('harvest.flowSaved'))
      // every litre figure is run time × this flow
      for (const key of ['water-summary', 'efficiency', 'weekly-summary']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}
