import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useFarm } from '@/atoms/farm'
import type { FarmData, Page } from '@/types'
import { http } from './http'

/**
 * Dual-source data hooks. Pages "print" server collections through these:
 * TanStack Query owns the data while a backend is connected; the demo store
 * (jotai) is the source while `simulate` is on. Mutations invalidate the same
 * query key so lists refresh and source switches stay consistent.
 *
 * jotai keeps only global state (farm control, demo data, auth) — see
 * src/atoms/farm.ts.
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
 * maximum so the UI shows everything that exists.
 */
export function useList<T>(
  key: string,
  path: string,
  selectDemo: (s: FarmData) => T[],
  params?: QueryParams,
): T[] {
  const simulate = useFarm((s) => s.simulate)
  const demo = useFarm((s) => selectDemo(s))
  const query = useQuery({
    queryKey: [key, params],
    queryFn: () =>
      http
        .get<Page<T>>(path + buildQS({ limit: 200, ...params }))
        .then((p) => p.items),
    enabled: !simulate,
  })
  return simulate ? demo : (query.data ?? [])
}

/**
 * Mutate one collection: the demo action while simulating, the REST endpoint
 * while live. `okMsg` is toasted on live success (demo actions toast themselves).
 */
export function useMutate<TVars>(
  key: string,
  demoFn: (vars: TVars) => void,
  apiFn: (vars: TVars) => Promise<unknown>,
  okMsg?: string,
) {
  const simulate = useFarm((s) => s.simulate)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => (simulate ? Promise.resolve(demoFn(vars)) : apiFn(vars)),
    onSuccess: () => {
      if (!simulate && okMsg) toast.success(okMsg)
      void qc.invalidateQueries({ queryKey: [key] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : i18n.t('farm.serverSaveFailed')),
  })
}
