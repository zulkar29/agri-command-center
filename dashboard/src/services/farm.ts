import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { authSessionAtom } from '@/atoms/auth'
import { useFarm } from '@/atoms/farm'
import { queryClient } from '@/lib/query-client'
import { http } from './http'
import { liveStreamAtom, useLiveStream } from './live'
import type { FarmSnapshot } from '@/types'

/**
 * Farm control API. GET /api/v1/farm returns the control snapshot (state +
 * zones/rules/irrigation log — collections with their own endpoints are not
 * embedded), and every mutation below resolves to a fresh snapshot, so the
 * global store can hydrate each response directly (backend: internal/api/farm.go).
 *
 * Page data (tasks, fields, ledger, stock, schedules, devices) does NOT go
 * through here — pages read those through the query hooks in this folder.
 */
export const farmService = {
  get: () => http.get<FarmSnapshot>('/farm'),

  update: (patch: Partial<Pick<FarmSnapshot, 'farmName' | 'simulate' | 'mode' | 'threshold' | 'duration' | 'valves' | 'notif' | 'lat' | 'lng' | 'maxDailyMinutes'>>) =>
    http.patch<FarmSnapshot>('/farm', patch),


  setPump: (state: 'on' | 'off') => http.put<FarmSnapshot>('/farm/pump', { state }),
  waterZones: (zones: number[], minutes?: number) =>
    http.post<FarmSnapshot>('/farm/waterings', { zones, minutes }),
  fillTank: () => http.post<FarmSnapshot>('/farm/tank-fills', {}),

  /** Answers with the fresh snapshot, so the store hydrates directly. */
  setRule: (id: string, on: boolean) => http.patch<FarmSnapshot>(`/rules/${id}`, { on }),
}

/**
 * The farm snapshot (control state + sensor mirror). The live stream pushes
 * it on every change; polling is the fallback — every 5 s without a stream
 * (60 s with one, as a safety net), backing off to 15 s while the API is
 * unreachable.
 */
export function useFarmSnapshot(enabled: boolean) {
  const streaming = useAtomValue(liveStreamAtom)
  return useQuery({
    queryKey: ['farm'],
    queryFn: farmService.get,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.error ? 15_000 : streaming ? 60_000 : 5_000),
  })
}

/**
 * Live data source (the docs/08 plan): while the demo simulation is off and a
 * login session exists, stream (and slowly poll) the backend for the farm snapshot and hydrate the
 * global store (control state + the mirror overview/sidebar read). List pages
 * fetch their own collections through the query hooks in src/services/. When
 * no API is reachable the store simply keeps its current state.
 */
export function useLiveFarm() {
  const simulate = useFarm((s) => s.simulate)
  const hydrate = useFarm((s) => s.hydrate)
  const setLive = useFarm((s) => s.setLive)
  const hasSession = useAtomValue(authSessionAtom) !== null

  const query = useFarmSnapshot(!simulate && hasSession)
  useLiveStream(!simulate && hasSession)

  useEffect(() => {
    if (query.data) hydrate(query.data)
  }, [query.data, hydrate])

  const connected = !simulate && query.data !== undefined && !query.isError
  useEffect(() => {
    setLive(connected)
  }, [connected, setLive])

  // switching sources (demo ↔ live) must drop lists cached from the other one
  const prev = useRef(simulate)
  useEffect(() => {
    if (prev.current !== simulate) {
      prev.current = simulate
      void queryClient.invalidateQueries()
    }
  }, [simulate])

  return query
}
