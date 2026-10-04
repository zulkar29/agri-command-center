import type { Field, Observation } from '@/lib/types'
import { useFarm } from '@/state/farm'
import i18n from '@/i18n'
import { sendOrQueue, withClientId } from '@/state/outbox'
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

export function useObservations() {
  return useList<Observation>('observations', '/observations', (s) => s.scout)
}

export function useAddObservation() {
  const addObservation = useFarm((s) => s.addObservation)
  return useMutate<{ kind: Observation['kind']; note: string; fieldId?: string }>(
    'observations',
    (x) => addObservation(x.kind, x.note),
    (x) => sendOrQueue({ collection: 'observations', method: 'POST', path: '/observations', body: withClientId(x, true) }),
    i18n.t('toasts.noted'),
  )
}
