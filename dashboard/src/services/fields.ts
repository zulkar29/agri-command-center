import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useFarm } from '@/atoms/farm'
import type { Field, Observation } from '@/types'
import i18n from '@/i18n'
import { http } from './http'
import { useList, useMutate } from './source'

export function useFields() {
  return useList<Field>('fields', '/fields', (s) => s.fields)
}

export function useAddField() {
  const addField = useFarm((s) => s.addField)
  return useMutate<Omit<Field, 'id' | 'age'>>(
    'fields',
    (x) => addField(x),
    (x) => http.post('/fields', x),
    i18n.t('toasts.fieldAdded'),
  )
}

export function useDeleteField() {
  const deleteField = useFarm((s) => s.deleteField)
  return useMutate<Field>('fields', (f) => deleteField(f.id), (f) => http.delete(`/fields/${f.id}`))
}

export interface FieldPatch {
  name?: string
  crop?: string
  area?: number
  plants?: number
  harvestAt?: number
  /** a zone index, or -1 to unlink */
  zone?: number
}

/** Correct a field without losing its ledger, harvest and water history (live only; the owner). */
export function useUpdateField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: FieldPatch & { id: string }) => http.patch<Field>(`/fields/${id}`, patch),
    onSuccess: () => {
      toast.success(i18n.t('fields.updated'))
      // name/area/zone also show in the per-field profit ('ledger' prefix) and water efficiency
      for (const key of ['fields', 'ledger', 'efficiency']) void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useObservations() {
  return useList<Observation>('observations', '/observations', (s) => s.scout)
}

export function useAddObservation() {
  const addObservation = useFarm((s) => s.addObservation)
  return useMutate<{ kind: Observation['kind']; note: string; fieldId?: string }>(
    'observations',
    (x) => addObservation(x.kind, x.note),
    (x) => http.post('/observations', x),
    i18n.t('toasts.noted'),
  )
}
