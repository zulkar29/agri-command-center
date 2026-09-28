import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import i18n from '@/i18n'
import { useAtomValue } from 'jotai'
import type { Page } from '@/types'
import { http } from './http'
import { liveStreamAtom } from './live'
import { buildQS, type QueryParams } from './source'

export interface DeviceStatus {
  id: string
  kind: 'sensor' | 'relay' | 'gateway'
  online: boolean
  /** e.g. battery voltage, signal strength */
  metrics: Record<string, number>
  lastSeenAt: number
}

export const devicesService = {
  /** Devices in the Paged envelope; filters: ?kind=&online=&q=&page=&limit=. */
  list: (params?: QueryParams) => http.get<Page<DeviceStatus>>(`/devices${buildQS(params)}`),
  /** Push a command (e.g. pump on/off) to a relay. */
  sendCommand: (id: string, command: 'on' | 'off') =>
    http.post<DeviceStatus>(`/devices/${id}/commands`, { command }),
  /** The device's ingest key (owner); empty when the node posts without one. */
  key: (id: string) => http.get<DeviceKey>(`/devices/${id}/key`),
  /** Mint a new key (owner); the old one stops working at once. */
  rotateKey: (id: string) => http.post<DeviceKey>(`/devices/${id}/key`, {}),
}

export interface DeviceKey {
  id: string
  apiKey: string
}

/** A device's ingest key, fetched only when the owner asks to see it. */
export function useDeviceKey(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['device-key', id],
    queryFn: () => devicesService.key(id),
    enabled,
    retry: false,
    staleTime: Infinity,
  })
}

/** Rotate a device key; the new key replaces the cached one. */
export function useRotateDeviceKey(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => devicesService.rotateKey(id),
    onSuccess: (key) => {
      qc.setQueryData(['device-key', id], key)
      toast.success(i18n.t('devices.key.rotated'))
    },
    onError: () => toast.error(i18n.t('devices.key.rotateFailed')),
  })
}

/**
 * Devices the backend knows about, refetched when the live stream reports a
 * change (every 60 s as a safety net), else every 10 s. Pass the
 * demo `simulate` flag; while simulating there is nothing to list.
 */
export function useDevices(simulate: boolean) {
  const streaming = useAtomValue(liveStreamAtom)
  return useQuery({
    queryKey: ['devices'],
    queryFn: () => devicesService.list({ limit: 200 }).then((p) => p.items),
    enabled: !simulate,
    retry: false,
    refetchInterval: (query) => (query.state.error ? 30_000 : streaming ? 60_000 : 10_000),
  })
}
