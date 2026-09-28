import { describe, expect, it } from 'vitest'
import { declineRate, hoursUntil, hoursWhere, isFungalRisk, moistureBands, shareInRange, vpd, vpdZone } from '@/lib/agro'

const H = 3_600_000

describe('vpd', () => {
  it('matches the textbook value at 25 °C / 60 %', () => {
    expect(vpd(25, 60)).toBeCloseTo(1.27, 2)
  })
  it('is zero in saturated air and never negative', () => {
    expect(vpd(30, 100)).toBe(0)
    expect(vpd(30, 120)).toBe(0)
  })
  it('sorts into the crop bands', () => {
    expect(vpdZone(0.3)).toBe('disease')
    expect(vpdZone(0.6)).toBe('low')
    expect(vpdZone(1.0)).toBe('ideal')
    expect(vpdZone(1.4)).toBe('high')
    expect(vpdZone(2.1)).toBe('stress')
  })
})

describe('declineRate', () => {
  it('measures the fall since the last watering, ignoring the jump', () => {
    const pts = [
      { t: 0, v: 30 },
      { t: H, v: 29 },
      { t: 2 * H, v: 55 }, // watered
      { t: 3 * H, v: 53 },
      { t: 4 * H, v: 51 },
      { t: 5 * H, v: 49 },
    ]
    expect(declineRate(pts)).toBeCloseTo(2, 5)
  })
  it('is 0 when not falling and null when too little data', () => {
    expect(declineRate([{ t: 0, v: 40 }, { t: 2 * H, v: 41 }, { t: 4 * H, v: 42 }])).toBe(0)
    expect(declineRate([{ t: 0, v: 40 }, { t: H, v: 39 }])).toBeNull()
  })
})

describe('hoursUntil', () => {
  it('projects the time to the threshold', () => {
    expect(hoursUntil(50, 2, 35)).toBe(7.5)
    expect(hoursUntil(30, 2, 35)).toBe(0)
    expect(hoursUntil(50, 0, 35)).toBeNull()
    expect(hoursUntil(50, null, 35)).toBeNull()
  })
})

describe('field rules', () => {
  it('marks the fungal window and counts hours', () => {
    expect(isFungalRisk(24, 90)).toBe(true)
    expect(isFungalRisk(34, 90)).toBe(false)
    expect(isFungalRisk(24, 70)).toBe(false)
    expect(hoursWhere([90, 70, 88, 91], 0.25, (rh) => rh >= 85)).toBe(1)
  })
  it('derives bands and the share in range', () => {
    expect(moistureBands(35)).toEqual({ dryBelow: 35, wetAbove: 65 })
    expect(moistureBands(80).wetAbove).toBe(100)
    expect(shareInRange([10, 40, 50, 90], 35, 65)).toBe(0.5)
    expect(shareInRange([], 0, 1)).toBe(0)
  })
})
