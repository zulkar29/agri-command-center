import i18n from '@/i18n'
import { bn } from '@/lib/format'
import type { Tone } from '@/lib/tone'

/** Pure helpers for the devices page: how healthy a device looks from the metrics it reports. */

/** Matches the server's offline alert: no data for 30 minutes. */
export function freshness(lastSeenAt: number, now: number): Tone {
  const min = (now - lastSeenAt) / 60_000
  if (min < 10) return 'ok'
  if (min < 30) return 'warn'
  return 'bad'
}

/** A 12 V lead-acid battery: ~11.8 V is flat, ~12.8 V is full. */
export function batteryPct(volt: number): number {
  return Math.round(Math.min(100, Math.max(0, ((volt - 11.8) / 1.0) * 100)))
}

/** Signal 0-100: the node's own % if it reports one, else from the gateway's RSSI (-100 dBm ≈ 0%, -50 dBm ≈ 100%). */
export function signalPct(m: Record<string, number>): number | null {
  if (m.signal !== undefined) return Math.round(Math.min(100, Math.max(0, m.signal)))
  if (m.rssi !== undefined) return Math.round(Math.min(100, Math.max(0, 2 * (m.rssi + 100))))
  return null
}

export const toneOfPct = (p: number): Tone => (p >= 60 ? 'ok' : p >= 30 ? 'warn' : 'bad')

/** "5 sec ago" / "12 min ago" / "3 h ago" / "2 d ago" in the UI language. */
export function ageLabel(lastSeenAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - lastSeenAt) / 1000))
  const t = i18n.t.bind(i18n)
  if (s < 60) return t('devices.ago.s', { n: bn(s) })
  if (s < 3600) return t('devices.ago.m', { n: bn(Math.floor(s / 60)) })
  if (s < 86_400) return t('devices.ago.h', { n: bn(Math.floor(s / 3600)) })
  return t('devices.ago.d', { n: bn(Math.floor(s / 86_400)) })
}

export type Health = 'ok' | 'warn' | 'bad' | 'idle'

interface DeviceLike {
  id: string
  kind: string
  online: boolean
  metrics: Record<string, number>
  lastSeenAt: number
}

/** A device counts as healthy only when it is marked online AND its data is recent. */
export function deviceHealth(d: DeviceLike | undefined, now: number): Health {
  if (!d) return 'idle'
  if (!d.online || !d.lastSeenAt) return 'bad'
  const f = freshness(d.lastSeenAt, now)
  return f === 'ok' ? 'ok' : f === 'warn' ? 'warn' : 'bad'
}

/** One thing wrong with a device: `key` picks the problem and fix texts (devices.issue.<key>). */
export interface DeviceIssue {
  deviceId: string
  key: 'offline' | 'slow' | 'battery' | 'signal' | 'noCurrent' | 'mismatch'
  tone: 'bad' | 'warn'
  /** interpolation values for the problem text */
  n?: number
}

/**
 * What needs attention on one device, worst first. pumpOn is the farm's pump
 * state, which a relay should agree with.
 */
export function deviceIssues(d: DeviceLike, now: number, pumpOn: boolean): DeviceIssue[] {
  const out: DeviceIssue[] = []
  const add = (key: DeviceIssue['key'], tone: DeviceIssue['tone'], n?: number) => out.push({ deviceId: d.id, key, tone, n })
  const health = deviceHealth(d, now)
  if (health === 'bad') add('offline', 'bad')
  else if (health === 'warn') add('slow', 'warn', Math.floor((now - d.lastSeenAt) / 60_000))
  const m = d.metrics
  if (m.battery_v !== undefined) {
    const p = batteryPct(m.battery_v)
    if (p < 30) add('battery', p < 10 ? 'bad' : 'warn', p)
  }
  const sig = signalPct(m)
  if (sig !== null && sig < 30) add('signal', 'warn', sig)
  if (d.kind === 'relay' && health !== 'bad') {
    if (m.state === 1 && m.current_a !== undefined && m.current_a <= 0) add('noCurrent', 'bad')
    if (m.state !== undefined && (m.state === 1) !== pumpOn) add('mismatch', 'warn')
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))
}
