import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAtomValue } from 'jotai'
import { http } from './http'
import { liveStreamAtom } from './live'
import { useFarm } from '@/atoms/farm'
import { deriveAlerts } from '@/lib/farm'
import i18n from '@/i18n'
import type { Page } from '@/types'
import type { Tone } from '@/lib/tone'

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

/** Active unacknowledged alerts while live — refetched when the live stream says they changed, else every 30 s. */
export function useServerAlerts(enabled: boolean) {
  const streaming = useAtomValue(liveStreamAtom)
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsService.list(true).then((rows) => rows.filter((a) => !a.ack)),
    enabled,
    refetchInterval: streaming ? 5 * 60_000 : 30_000,
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
 * The alerts every surface shows (overview page, sidebar badge): server rows
 * while live, the demo derivation while নমুনা মোড — one shape, both sources.
 */
export function useFarmAlerts(): { items: { id: string; title: string; detail: string; tone: Tone }[]; live: boolean; ack: (id: string) => void } {
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
