import { atom, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useFarm } from '@/atoms/farm'
import type { AuthSession, AuthUser, Role } from '@/types'

/**
 * The login session is the one piece of client state that is global and
 * independent of the farm data: {token, refreshToken, user} persisted to
 * localStorage, so a refresh stays logged in. http.ts reads the token from
 * here on every call and clears the atom when the server answers 401
 * (expired/revoked).
 */
// getOnInit: read localStorage on the first render. Without it the atom starts null and
// RequireAuth bounces a reload or deep link to /login, which then forwards to /overview.
export const authSessionAtom = atomWithStorage<AuthSession | null>('farm-command-auth', null, undefined, { getOnInit: true })

export const currentUserAtom = atom<AuthUser | null>((get) => get(authSessionAtom)?.user ?? null)

// --- role permissions -----------------------------------------------------
// Mirrors the backend matrix in backend/internal/api/router.go: মালিক does
// everything, অপারেটর runs irrigation/tasks/scouting/devices, দর্শক reads.
// The server enforces the real rules; this only keeps the UI honest.

const LEVEL: Record<Role, number> = { মালিক: 2, অপারেটর: 1, দর্শক: 0 }

/** Write areas and the role level they need (1 = অপারেটর, 2 = মালিক). */
export type WritePerm =
  | 'irrigation' // pump/valves/mode/threshold/water/tank/rules/ack
  | 'tasks'
  | 'scout' // observation notes
  | 'schedules'
  | 'devices'
  | 'fields' // জমি — owner
  | 'finance' // টাকা — owner
  | 'stock' // মজুত — owner
  | 'stockUse' // মজুত ব্যবহার লেখা — operator (a cost needs the owner)
  | 'farmSetup' // নাম/নোটিফিকেশন/নমুনা — owner

const NEEDED: Record<WritePerm, number> = {
  irrigation: 1,
  tasks: 1,
  scout: 1,
  schedules: 1,
  devices: 1,
  fields: 2,
  finance: 2,
  stock: 2,
  stockUse: 1,
  farmSetup: 2,
}

/**
 * `const can = useCan()` → `can('tasks')`: may the current user write here?
 * নমুনা মোড (and having no login at all) allows everything — the demo store
 * is local, permissions only govern the shared server.
 */
export function useCan(): (perm: WritePerm) => boolean {
  const user = useAtomValue(currentUserAtom)
  const simulate = useFarm((s) => s.simulate)
  return (perm) => simulate || !user || LEVEL[user.role] >= NEEDED[perm]
}
