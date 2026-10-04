import type { Task } from '@/lib/types'
import { useFarm } from '@/state/farm'
import i18n from '@/i18n'
import { sendOrQueue, withClientId } from '@/state/outbox'
import { http } from './http'
import { useList, useMutate } from './source'

export function useTasks() {
  return useList<Task>('tasks', '/tasks', (s) => s.tasks)
}

export function useAddTask() {
  const addTask = useFarm((s) => s.addTask)
  return useMutate<Omit<Task, 'id' | 'done'>>(
    'tasks',
    (x) => addTask(x),
    // may wait offline: the client id makes a replay a 409, not a duplicate
    (x) => sendOrQueue({ collection: 'tasks', method: 'POST', path: '/tasks', body: withClientId(x) }),
    i18n.t('toasts.taskAdded'),
  )
}

export function useToggleTask() {
  const toggleTask = useFarm((s) => s.toggleTask)
  return useMutate<Task>(
    'tasks',
    (t) => toggleTask(t.id),
    (t) => sendOrQueue({ collection: 'tasks', method: 'PATCH', path: `/tasks/${t.id}`, body: { done: !t.done }, clientId: t.id }),
  )
}

export function useDeleteTask() {
  const deleteTask = useFarm((s) => s.deleteTask)
  return useMutate<Task>('tasks', (t) => deleteTask(t.id), (t) => http.delete(`/tasks/${t.id}`))
}
