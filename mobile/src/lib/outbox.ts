/**
 * The offline outbox, as pure logic (no React Native, no storage): which
 * writes may wait for a connection, what a failed send means, and how the
 * waiting writes are shown in lists. state/outbox.ts persists the queue and
 * does the sending; this file is what the unit tests cover.
 *
 * What may be queued: adding a task, a ledger entry or a field note, and
 * ticking a task off — things a person does standing in a field with no
 * signal. Pump commands and deletes are never queued: they must be live and
 * confirmed. Each queued create carries a client-chosen id, so replaying one
 * the server already has is a 409 (see backend api/respond.go checkClientID),
 * not a duplicate.
 */

export type Collection = 'tasks' | 'ledger' | 'observations'

export interface QueuedWrite {
  /** the id of the row a POST creates, or of the row a PATCH changes */
  clientId: string
  collection: Collection
  method: 'POST' | 'PATCH'
  /** relative to the API base, e.g. '/tasks' or '/tasks/ab12cd34' */
  path: string
  body: Record<string, unknown>
  /** epoch ms the user did it */
  queuedAt: number
}

/** What to do with a queued write after a send attempt. */
export type Outcome = 'sent' | 'retry' | 'drop'

/**
 * Status 0 is "no connection / timed out" (the http layer's ApiError(0)).
 * Anything that may succeed later is retried; a 409 on a create means the
 * server already has it. Everything else is the server saying no for good.
 */
export function classify(method: QueuedWrite['method'], status: number): Outcome {
  if (status >= 200 && status < 300) return 'sent'
  if (status === 409 && method === 'POST') return 'sent'
  if (status === 0 || status >= 500 || status === 401 || status === 408 || status === 429) return 'retry'
  return 'drop'
}

/** True when a failure means "no connection" — the only case worth queueing for. */
export const isOffline = (status: number) => status === 0

/** A client-chosen id: letters, digits and dashes, 6-40 long (what the server accepts). */
export function newClientId(now: number = Date.now(), rand: () => number = Math.random): string {
  return `m-${now.toString(36)}-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0')}`
}

/** Adds a write; consecutive PATCHes to the same row collapse into one (the latest wins). */
export function enqueue(queue: readonly QueuedWrite[], w: QueuedWrite): QueuedWrite[] {
  const last = queue[queue.length - 1]
  if (w.method === 'PATCH' && last && last.method === 'PATCH' && last.path === w.path) {
    return [...queue.slice(0, -1), { ...last, body: { ...last.body, ...w.body }, queuedAt: w.queuedAt }]
  }
  return [...queue, w]
}

/** The row id a path points at: '/tasks/ab12' -> 'ab12'. */
const targetId = (path: string) => path.split('/').filter(Boolean)[1] ?? ''

/** Ids of the rows that still wait to be sent (created or changed). */
export function pendingIds(queue: readonly QueuedWrite[]): Set<string> {
  return new Set(queue.map((w) => w.clientId))
}

/**
 * The server's list with the waiting writes laid over it: queued creates
 * appear at the top (unless the server already has them), queued changes are
 * applied. Rows are shown as the user left them, before the connection returns.
 */
export function mergeQueued<T extends { id: string }>(
  list: readonly T[],
  queue: readonly QueuedWrite[],
  collection: Collection,
): T[] {
  const mine = queue.filter((w) => w.collection === collection)
  if (mine.length === 0) return list as T[]

  const have = new Set(list.map((x) => x.id))
  const created: T[] = []
  for (const w of mine) {
    if (w.method !== 'POST' || have.has(w.clientId)) continue
    const base = collection === 'tasks' ? { done: false } : { at: w.queuedAt }
    created.push({ ...base, ...w.body, id: w.clientId } as unknown as T)
  }
  const changes = mine.filter((w) => w.method === 'PATCH')
  const apply = (x: T): T => {
    let out = x
    for (const w of changes) if (targetId(w.path) === x.id) out = { ...out, ...w.body }
    return out
  }
  return [...created.reverse(), ...list].map(apply)
}
