import { useEffect } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { atom, getDefaultStore, useAtomValue } from 'jotai'
import i18n from '@/i18n'
import {
  classify,
  enqueue,
  isOffline,
  newClientId,
  type Collection,
  type QueuedWrite,
} from '@/lib/outbox'
import { ApiError, http } from '@/services/http'
import { queryClient } from '@/services/query-client'
import { authSessionAtom, demoAtom, serverUrlAtom } from './conn'
import { toast } from './toast'

/**
 * The offline outbox (logic in lib/outbox.ts): writes made without a
 * connection wait here — persisted, so closing the app does not lose them —
 * and are sent in order when the server is reachable again.
 */

const KEY = 'farm-command-outbox'
const store = getDefaultStore()

export const outboxAtom = atom<QueuedWrite[]>([])

function save(queue: QueuedWrite[]) {
  store.set(outboxAtom, queue)
  void AsyncStorage.setItem(KEY, JSON.stringify(queue)).catch(() => {
    // storage full or unavailable — the queue still lives for this session
  })
}

/** Reads the persisted queue at app start (writes queued meanwhile stay behind it). */
export async function loadOutbox() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) save([...(JSON.parse(raw) as QueuedWrite[]), ...store.get(outboxAtom)])
  } catch {
    // unreadable queue — start empty rather than block the app
  }
}

interface Write {
  collection: Collection
  method: 'POST' | 'PATCH'
  path: string
  body: Record<string, unknown>
}

/** What a queueable mutation resolves to when it had to wait. */
export interface Queued {
  queued: true
}
export const wasQueued = (x: unknown): x is Queued => typeof x === 'object' && x !== null && (x as Queued).queued === true

/**
 * Sends a write now; if there is no connection, keeps it for later and
 * resolves {queued: true}. Server rejections (validation, permissions) still
 * throw — those are not connection problems.
 */
export async function sendOrQueue(w: Write & { clientId?: string }): Promise<unknown> {
  const clientId = w.clientId ?? (w.method === 'POST' ? String(w.body.id) : (w.path.split('/').filter(Boolean)[1] ?? ''))
  try {
    return w.method === 'POST' ? await http.post(w.path, w.body) : await http.patch(w.path, w.body)
  } catch (e) {
    if (e instanceof ApiError && isOffline(e.status)) {
      save(enqueue(store.get(outboxAtom), { ...w, clientId, queuedAt: Date.now() }))
      return { queued: true } satisfies Queued
    }
    throw e
  }
}

/** A create body with its client id (and time, for dated rows) filled in. */
export function withClientId<T extends Record<string, unknown>>(body: T, dated = false): T & { id: string; at?: number } {
  return { ...body, id: newClientId(), ...(dated ? { at: Date.now() } : {}) }
}

let flushing = false

/** Sends the waiting writes in order; stops at the first one that cannot go yet. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return
  const online = !!store.get(serverUrlAtom) && !!store.get(authSessionAtom) && !store.get(demoAtom)
  if (!online || store.get(outboxAtom).length === 0) return
  flushing = true
  let sent = 0
  const touched = new Set<string>()
  try {
    for (;;) {
      const next = store.get(outboxAtom)[0]
      if (!next) break
      let status = 200
      let message = ''
      try {
        if (next.method === 'POST') await http.post(next.path, next.body)
        else await http.patch(next.path, next.body)
      } catch (e) {
        status = e instanceof ApiError ? e.status : 0
        message = e instanceof Error ? e.message : ''
      }
      const outcome = classify(next.method, status)
      if (outcome === 'retry') break // try again later; later writes wait their turn
      // re-read the queue: writes may have been queued while this one was in flight
      save(store.get(outboxAtom).filter((w) => w !== next))
      touched.add(next.collection)
      if (outcome === 'sent') sent++
      else toast.error(message || i18n.t('m.offline.dropped'))
    }
  } finally {
    flushing = false
  }
  for (const key of touched) void queryClient.invalidateQueries({ queryKey: [key] })
  if (sent > 0) toast.success(i18n.t('m.offline.sent', { n: sent }))
}

/** Mount once at the root: flush at start, when the app returns to the foreground, and every 30s while writes wait. */
export function useOutboxFlusher() {
  const queue = useAtomValue(outboxAtom)
  const waiting = queue.length > 0

  useEffect(() => {
    void loadOutbox().then(flushOutbox)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void flushOutbox()
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => void flushOutbox(), 30_000)
    return () => clearInterval(timer)
  }, [waiting])
}
