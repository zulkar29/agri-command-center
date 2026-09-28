import { describe, expect, it } from 'vitest'
import { batteryPct, deviceHealth, deviceIssues, freshness, signalPct, toneOfPct } from '@/lib/devices'

const NOW = 1_000_000_000_000
const MIN = 60_000

describe('freshness', () => {
  it('is ok under 10 minutes, warn under 30, bad after', () => {
    expect(freshness(NOW - 2 * MIN, NOW)).toBe('ok')
    expect(freshness(NOW - 15 * MIN, NOW)).toBe('warn')
    expect(freshness(NOW - 45 * MIN, NOW)).toBe('bad')
  })
})

describe('batteryPct', () => {
  it('maps 11.8-12.8 V onto 0-100 and clamps', () => {
    expect(batteryPct(12.3)).toBe(50)
    expect(batteryPct(10)).toBe(0)
    expect(batteryPct(14)).toBe(100)
  })
})

describe('signalPct', () => {
  it('prefers the reported percentage', () => {
    expect(signalPct({ signal: 82, rssi: -90 })).toBe(82)
  })
  it('derives it from RSSI otherwise', () => {
    expect(signalPct({ rssi: -61 })).toBe(78)
    expect(signalPct({ rssi: -120 })).toBe(0)
  })
  it('is null when the device reports neither', () => {
    expect(signalPct({ state: 1 })).toBeNull()
  })
})

describe('toneOfPct', () => {
  it('buckets', () => {
    expect([80, 40, 10].map(toneOfPct)).toEqual(['ok', 'warn', 'bad'])
  })
})

describe('deviceIssues', () => {
  const dev = (over: Partial<{ kind: string; online: boolean; metrics: Record<string, number>; lastSeenAt: number }> = {}) => ({
    id: 'd1', kind: 'sensor', online: true, metrics: {}, lastSeenAt: NOW - MIN, ...over,
  })

  it('finds nothing on a healthy device', () => {
    expect(deviceIssues(dev({ metrics: { battery_v: 12.6, signal: 80 } }), NOW, false)).toEqual([])
  })

  it('reports offline, low battery and weak signal, worst first', () => {
    const keys = deviceIssues(dev({ online: false, metrics: { battery_v: 11.9, signal: 10 } }), NOW, false).map((i) => i.key)
    expect(keys[0]).toBe('offline')
    expect([...keys].sort()).toEqual(['battery', 'offline', 'signal'])
  })

  it('counts minutes for slow data', () => {
    expect(deviceIssues(dev({ lastSeenAt: NOW - 15 * MIN }), NOW, false)).toEqual([{ deviceId: 'd1', key: 'slow', tone: 'warn', n: 15 }])
  })

  it('flags a relay that is on without current, or disagrees with the pump', () => {
    expect(deviceIssues(dev({ kind: 'relay', metrics: { state: 1, current_a: 0 } }), NOW, true).map((i) => i.key)).toEqual(['noCurrent'])
    expect(deviceIssues(dev({ kind: 'relay', metrics: { state: 0 } }), NOW, true).map((i) => i.key)).toEqual(['mismatch'])
  })
})

describe('deviceHealth', () => {
  it('is idle without a device and bad when marked offline', () => {
    expect(deviceHealth(undefined, NOW)).toBe('idle')
    expect(deviceHealth({ id: 'x', kind: 'sensor', online: false, metrics: {}, lastSeenAt: NOW }, NOW)).toBe('bad')
  })
})
