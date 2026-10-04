import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DeviceStatus, Page } from '@/lib/types'
import { toast } from '@/state/toast'
import i18n from '@/i18n'
import { http } from './http'
import { buildQS, type QueryParams } from './source'

export const devicesService = {
  /** Devices in the Paged envelope; filters: ?kind=&online=&q=&page=&limit=. */
  list: (params?: QueryParams) => http.get<Page<DeviceStatus>>(`/devices${buildQS(params)}`),
  /** Push a command (e.g. pump on/off) to a relay. */
  sendCommand: (id: string, command: 'on' | 'off') =>
    http.post<DeviceStatus>(`/devices/${id}/commands`, { command }),
}

/**
 * Devices the backend knows about, refreshed as telemetry arrives (the mobile
 * twin of dashboard's hook — demo mode shows the static seed list instead).
 */
export function useDevices(demo: boolean) {
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesService.list({ limit: 200 }).then((p) => p.items),
    enabled: !demo,
    retry: false,
    refetchInterval: (query) => (query.state.error ? 30_000 : 10_000),
  })
}

/** Send an on/off command to a relay; the farm store picks up the synced pump
 *  state on its next snapshot poll. */
export function useDeviceCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, command }: { id: string; command: 'on' | 'off' }) =>
      devicesService.sendCommand(id, command),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.command === 'on' ? i18n.t('m.devices.relayOn') : i18n.t('m.devices.relayOff'),
      )
      void qc.invalidateQueries({ queryKey: ['devices'] })
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : i18n.t('farm.serverCmdFailed')),
  })
}
