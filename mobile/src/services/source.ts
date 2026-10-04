import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import type { FarmData, Page } from '@/lib/types'
import { demoAtom } from '@/state/conn'
import { useFarm } from '@/state/farm'
import { mergeQueued, type Collection } from '@/lib/outbox'
import { outboxAtom, wasQueued } from '@/state/outbox'
import { toast } from '@/state/toast'
import i18n from '@/i18n'
import { http } from './http'

/**
 * Dual-source data hooks — the mobile twin of dashboard's services/source.ts.
 * Screens print server collections through these: TanStack Query owns the
 * data while নমুনা মোড is off; the demo store (jotai) is the source while it
 * is on. Mutations invalidate the same query key so lists refresh and source
 * switches stay consistent.
 *
 * jotai keeps only global state (farm control, demo data) — see state/farm.ts.
 */

/** Filter/search/pagination params appended to a list endpoint's query string. */
export type QueryParams = Record<string, string | number | boolean | undefined>

/** Serializes params, skipping empty values; '' when nothing to append. */
export function buildQS(params?: QueryParams): string {
  if (!params) return ''
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return pairs.length ? `?${pairs.join('&')}` : ''
}

/**
 * One server collection as a plain array. Filters (`q`, resource-specific
 * params…) pass straight through; the page limit defaults to the backend's
 * maximum so the screens show everything that exists.
 */
export function useList<T extends { id: string }>(
  key: string,
  path: string,
  selectDemo: (s: FarmData) => T[],
  params?: QueryParams,
): T[] {
  const demo = useAtomValue(demoAtom)
  const demoList = useFarm(selectDemo)
  const queue = useAtomValue(outboxAtom)
  const query = useQuery({
    queryKey: [key, params],
    queryFn: () =>
      http
        .get<Page<T>>(path + buildQS({ limit: 200, ...params }))
        .then((p) => p.items),
    enabled: !demo,
  })
  if (demo) return demoList
  // writes still waiting for a connection show up as the user left them
  return mergeQueued(query.data ?? [], queue, key as Collection)
}

/**
 * Mutate one collection: the demo action while in নমুনা মোড, the REST
 * endpoint while live. `okMsg` is toasted on live success (demo actions toast
 * themselves).
 */
export function useMutate<TVars>(
  key: string,
  demoFn: (vars: TVars) => void,
  apiFn: (vars: TVars) => Promise<unknown>,
  okMsg?: string,
) {
  const demo = useAtomValue(demoAtom)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => (demo ? Promise.resolve(demoFn(vars)) : apiFn(vars)),
    onSuccess: (data) => {
      if (!demo && wasQueued(data)) toast.info(i18n.t('m.offline.queued'))
      else if (!demo && okMsg) toast.success(okMsg)
      void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}
