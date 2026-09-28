import { useFarm } from '@/atoms/farm'
import type { Schedule } from '@/types'
import i18n from '@/i18n'
import { http } from './http'
import { useList, useMutate } from './source'

export function useSchedules() {
  return useList<Schedule>('schedules', '/schedules', (s) => s.schedules)
}

export function useAddSchedule() {
  const addSchedule = useFarm((s) => s.addSchedule)
  return useMutate<Omit<Schedule, 'id' | 'on'>>(
    'schedules',
    (x) => addSchedule(x),
    (x) => http.post('/schedules', x),
    i18n.t('toasts.scheduleAdded'),
  )
}

export function useToggleSchedule() {
  const toggleSchedule = useFarm((s) => s.toggleSchedule)
  return useMutate<Schedule>(
    'schedules',
    (x) => toggleSchedule(x.id),
    (x) => http.patch(`/schedules/${x.id}`, { on: !x.on }),
  )
}

export function useDeleteSchedule() {
  const deleteSchedule = useFarm((s) => s.deleteSchedule)
  return useMutate<Schedule>(
    'schedules',
    (x) => deleteSchedule(x.id),
    (x) => http.delete(`/schedules/${x.id}`),
    i18n.t('toasts.scheduleDeleted'),
  )
}
