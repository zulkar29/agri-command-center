import { useFarm } from '@/atoms/farm'
import type { Task } from '@/types'
import i18n from '@/i18n'
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
    (x) => http.post('/tasks', x),
    i18n.t('toasts.taskAdded'),
  )
}

export function useToggleTask() {
  const toggleTask = useFarm((s) => s.toggleTask)
  return useMutate<Task>(
    'tasks',
    (t) => toggleTask(t.id),
    (t) => http.patch(`/tasks/${t.id}`, { done: !t.done }),
  )
}

export function useDeleteTask() {
  const deleteTask = useFarm((s) => s.deleteTask)
  return useMutate<Task>('tasks', (t) => deleteTask(t.id), (t) => http.delete(`/tasks/${t.id}`))
}
