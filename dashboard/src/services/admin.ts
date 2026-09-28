import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Page, Role } from '@/types'
import { http } from './http'
import i18n from '@/i18n'

/** Owner administration: accounts, own password, audit. */

export interface Account {
  id: string
  name: string
  email: string
  role: Role
}

export const usersService = {
  list: () => http.get<Page<Account>>('/users?limit=200').then((p) => p.items),
  create: (x: { name: string; email: string; password: string; role: Role }) =>
    http.post<Account>('/users', x),
  update: (id: string, x: { name?: string; role?: Role; password?: string }) =>
    http.patch<Account>(`/users/${id}`, x),
  remove: (id: string) => http.delete<void>(`/users/${id}`),
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<void>('/auth/password', { currentPassword, newPassword }),
}

export function useUsers(enabled: boolean) {
  return useQuery({ queryKey: ['users'], queryFn: usersService.list, enabled })
}

// account changes are audited too, so the audit trail refreshes with the list
const invalidateUsers = (qc: ReturnType<typeof useQueryClient>) => {
  for (const key of ['users', 'audit']) void qc.invalidateQueries({ queryKey: [key] })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: usersService.create,
    onSuccess: () => {
      toast.success(i18n.t('settings.userAdded'))
      invalidateUsers(qc)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...x }: { id: string } & Parameters<typeof usersService.update>[1]) =>
      usersService.update(id, x),
    onSuccess: () => {
      toast.success(i18n.t('settings.userUpdated'))
      invalidateUsers(qc)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: usersService.remove,
    onSuccess: () => {
      toast.info(i18n.t('settings.userDeleted'))
      invalidateUsers(qc)
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      usersService.changePassword(current, next),
    onSuccess: () => toast.success(i18n.t('settings.passwordChanged')),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('settings.passwordWrong')),
  })
}

export interface AuditRow {
  id: string
  user: string
  action: string
  detail: string
  at: number
}

export function useAudit(enabled: boolean) {
  return useQuery({
    queryKey: ['audit'],
    queryFn: () => http.get<Page<AuditRow>>('/audit?limit=30').then((p) => p.items),
    enabled,
  })
}
