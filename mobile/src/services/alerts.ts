import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from './http'
import { useFarm } from '@/state/farm'
import { deriveAlerts } from '@/lib/farm'
import { toast } from '@/state/toast'
import i18n from '@/i18n'
import type { Page, Tone } from '@/lib/types'

/** One server-side alert row (GET /api/v1/alerts; backend internal/alerts). */
export interface ServerAlert {
  id: string
  kind: string
  title: string
  detail: string
  tone: 'bad' | 'warn'
  active: boolean
  ack: boolean
  firstAt: number
  lastAt: number
}

export const alertsService = {
  list: (active = false) =>
    http
      .get<Page<ServerAlert>>(`/alerts?limit=100${active ? '&active=true' : ''}`)
      .then((p) => p.items),
  ack: (id: string, ack = true) => http.patch<ServerAlert>(`/alerts/${id}`, { ack }),
}

/** Active unacknowledged alerts while live — refreshed as the engine ticks. */
export function useServerAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsService.list(true).then((rows) => rows.filter((a) => !a.ack)),
    enabled,
    refetchInterval: 30_000,
  })
}

/** Ack one server alert (live mode's version of the store's ackAlert). */
export function useAckAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => alertsService.ack(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
    onError: () => toast.error(i18n.t('farm.serverCmdFailed')),
  })
}

/**
 * The alerts the overview shows: server rows while live, the demo derivation
 * while নমুনা মোড — one shape, both sources (mobile twin of the dashboard's
 * services/alerts.ts).
 */
export function useFarmAlerts(): {
  items: { id: string; title: string; detail: string; tone: Tone }[]
  live: boolean
  ack: (id: string) => void
} {
  const s = useFarm()
  const server = useServerAlerts(s.live)
  const ackMutation = useAckAlert()
  if (s.live) {
    return {
      items: (server.data ?? []).map((a) => ({ id: a.id, title: a.title, detail: a.detail, tone: a.tone as Tone })),
      live: true,
      ack: (id: string) => ackMutation.mutate(id),
    }
  }
  const items = deriveAlerts(s).filter((a) => !s.ack[a.id])
  return { items, live: false, ack: (id: string) => s.ackAlert(id) }
}
