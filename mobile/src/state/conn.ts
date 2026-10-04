import { atom, getDefaultStore, useAtomValue } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { createSeed } from '@/lib/seed'
import type { AuthSession, FarmSnapshot, Role } from '@/lib/types'
import { authService } from '@/services/auth'
import { farmService } from '@/services/farm'
import { normalizeUrl, onSessionUpdate, setBaseUrl, setSession } from '@/services/http'
import { queryClient } from '@/services/query-client'
import { hydrate, setLocal, snapshotAtom } from './farm'
import { jsonAsyncStorage, jsonSecureStorage } from './storage'

const store = getDefaultStore()

/** Saved server address, e.g. http://192.168.0.5:8080 (empty = never set). */
const serverStoredAtom = atomWithStorage<string>(
  'farm-command-server-url',
  '',
  jsonAsyncStorage<string>(),
)
let serverCache = ''
export const serverUrlAtom = atom((get) => {
  const v = get(serverStoredAtom)
  if (v instanceof Promise) return serverCache
  serverCache = v
  return v
})
export function setServerUrl(url: string) {
  serverCache = url
  store.set(serverStoredAtom, url)
  if (url) setBaseUrl(url)
}

/** The login session {token, refreshToken, user} — persisted in the OS
 *  keychain (expo-secure-store, see storage.ts), and the tokens feed http.ts. When http.ts refreshes the pair it calls us back so the new
 *  session is persisted and the atom stays in sync. */
const authStoredAtom = atomWithStorage<AuthSession | null>(
  'farm-command-auth',
  null,
  jsonSecureStorage<AuthSession | null>(),
)
let authCache: AuthSession | null = null
export const authSessionAtom = atom((get) => {
  const v = get(authStoredAtom)
  if (v instanceof Promise) return authCache
  authCache = v
  return v
})
export function setAuth(session: AuthSession | null) {
  authCache = session
  store.set(authStoredAtom, session)
  setSession(session)
}
export function clearAuth() {
  setAuth(null)
}
onSessionUpdate(setAuth)

// --- role permissions -------------------------------------------------------
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
  | 'farmSetup' // নাম/নোটিফিকেশন — owner

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
 * নমুনা মোড (and having no server at all) allows everything — the demo store
 * is local, permissions only govern the shared server.
 */
export function useCan(): (perm: WritePerm) => boolean {
  const session = useAtomValue(authSessionAtom)
  const serverUrl = useAtomValue(serverUrlAtom)
  const demo = useAtomValue(demoAtom)
  const role = session?.user.role
  return (perm) => demo || !serverUrl || !role || LEVEL[role] >= NEEDED[perm]
}

/** নমুনা মোড: run the built-in demo dataset instead of a server. */
const demoStoredAtom = atomWithStorage<boolean>(
  'farm-command-demo',
  false,
  jsonAsyncStorage<boolean>(),
)
let demoCache = false
export const demoAtom = atom((get) => {
  const v = get(demoStoredAtom)
  if (v instanceof Promise) return demoCache
  demoCache = v
  return v
})
export function setDemo(on: boolean) {
  demoCache = on
  store.set(demoStoredAtom, on)
}

/** False until the persisted connection settings have been read — the route
 * gate waits on it so a saved server is not mistaken for "never set". */
export const bootedAtom = atom(false)

/**
 * Verify a server address, log in, point the http client at it and pull the
 * first snapshot. Throws a Bangla error message when unreachable or the
 * credentials are wrong.
 */
export async function connectServer(rawUrl: string, email: string, password: string): Promise<FarmSnapshot> {
  const base = normalizeUrl(rawUrl)
  setBaseUrl(base)
  await farmService.health()
  setAuth(await authService.login(email, password))
  return finishConnect(base)
}

/** Same as connectServer but authenticating with a Google ID token. */
export async function connectGoogle(rawUrl: string, idToken: string): Promise<FarmSnapshot> {
  const base = normalizeUrl(rawUrl)
  setBaseUrl(base)
  await farmService.health()
  setAuth(await authService.google(idToken))
  return finishConnect(base)
}

async function finishConnect(base: string): Promise<FarmSnapshot> {
  const data = await farmService.get()
  setServerUrl(base)
  setDemo(false)
  hydrate(data)
  // list data now comes from the server — drop anything cached from নমুনা মোড
  queryClient.clear()
  return data
}

/** Log out on the server (best-effort), forget the session and the server. */
export async function logoutServer() {
  if (authCache) {
    try {
      await authService.logout(authCache.refreshToken)
    } catch {
      // server unreachable or the session already dead — forget it anyway
    }
  }
  clearAuth()
  disconnect()
}

/** Switch to নমুনা মোড with a fresh seed (and the simulator ticking). */
export function startDemo() {
  store.set(snapshotAtom, null)
  setDemo(true)
  setServerUrl('')
  setBaseUrl('')
  clearAuth()
  const seed = createSeed()
  seed.simulate = true
  setLocal(seed)
  queryClient.clear()
}

/** Forget the server, the login session and the snapshot (used from settings). */
export function disconnect() {
  store.set(snapshotAtom, null)
  setServerUrl('')
  setDemo(false)
  setBaseUrl('')
  clearAuth()
  queryClient.clear()
}
