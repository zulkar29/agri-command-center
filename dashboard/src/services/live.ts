import { useEffect } from 'react'
import { atom, getDefaultStore } from 'jotai'
import { authSessionAtom } from '@/atoms/auth'
import { queryClient } from '@/lib/query-client'
import { apiStream } from './http'
import type { FarmSnapshot } from '@/types'

/**
 * Live updates over Server-Sent Events (GET /api/v1/stream; backend
 * internal/api/stream.go). Events are written straight into the react-query
 * cache, so pages keep using their usual hooks:
 *
 *   farm      → the ['farm'] snapshot (useLiveFarm hydrates the store from it)
 *   telemetry → the averaged chart buckets are refetched (at most once a minute)
 *   alerts / devices → those lists are refetched
 *
 * While the stream is up, `liveStreamAtom` is true and the hooks drop their
 * polling to a slow safety net; when it drops they poll as before. Read with
 * fetch, not EventSource, because EventSource cannot send the bearer header.
 */
export const liveStreamAtom = atom(false)

export interface SSEEvent {
  name: string
  data: string
}

/** Splits a buffer into complete SSE events plus the unfinished rest. Comments (": ping") and retry lines are skipped. */
export function parseSSE(buffer: string): { events: SSEEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: SSEEvent[] = []
  for (const block of blocks) {
    let name = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length > 0) events.push({ name, data: data.join('\n') })
  }
  return { events, rest }
}

let lastBucketRefresh = 0

function handle(ev: SSEEvent) {
  const data: unknown = JSON.parse(ev.data)
  switch (ev.name) {
    case 'farm':
      queryClient.setQueryData(['farm'], data as FarmSnapshot)
      break
    case 'telemetry':
      // averaged charts: one refetch a minute is plenty for 15-minute buckets
      if (Date.now() - lastBucketRefresh > 60_000) {
        lastBucketRefresh = Date.now()
        void queryClient.invalidateQueries({ queryKey: ['telemetry-buckets'] })
      }
      break
    case 'alerts':
    case 'devices':
      void queryClient.invalidateQueries({ queryKey: [ev.name] })
      break
    // 'expired': the server closes next; the reconnect refreshes the token
  }
}

/** Keeps one stream open while enabled, reconnecting with backoff. */
export function useLiveStream(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const store = getDefaultStore()
    const abort = new AbortController()
    let delay = 1_000

    const run = async () => {
      let first = true
      while (!abort.signal.aborted) {
        try {
          const res = await apiStream('/stream', abort.signal)
          const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
          store.set(liveStreamAtom, true)
          delay = 1_000
          // events may have been missed while disconnected: the snapshot comes
          // first on its own, the lists need a refetch
          if (!first) void queryClient.invalidateQueries({ predicate: (q) => ['telemetry-buckets', 'pump-runs', 'alerts', 'devices'].includes(q.queryKey[0] as string) })
          first = false
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            const parsed = parseSSE(buffer + value)
            buffer = parsed.rest
            parsed.events.forEach(handle)
          }
        } catch {
          // network drop, 401 after a failed refresh, 503 … — retry below
        }
        store.set(liveStreamAtom, false)
        if (abort.signal.aborted || !store.get(authSessionAtom)) return
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 30_000)
      }
    }
    void run()
    return () => {
      abort.abort()
      store.set(liveStreamAtom, false)
    }
  }, [enabled])
}
