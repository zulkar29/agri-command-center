import { describe, expect, it } from 'vitest'
import { FORECAST } from '@/data/constants'
import { deriveAlerts, deriveRecs, dueFor, fieldStage, isLowStock, isOverdue, mean, riskInfo, zoneStatus } from '@/lib/farm'
import type { FarmData, Field, Task } from '@/types'

describe('mean', () => {
  it('averages values', () => {
    expect(mean([10, 20, 30])).toBe(20)
  })
  it('returns 0 for an empty list instead of NaN', () => {
    expect(mean([])).toBe(0)
  })
})

describe('zoneStatus', () => {
  it('flags soil below the threshold as needing water', () => {
    expect(zoneStatus(30, 35).label).toBe('সেচ দরকার')
    expect(zoneStatus(30, 35).tone).toBe('bad')
  })
  it('warns just above the threshold', () => {
    expect(zoneStatus(40, 35).label).toBe('শুকিয়ে আসছে')
    expect(zoneStatus(40, 35).tone).toBe('warn')
  })
  it('is fine with enough moisture', () => {
    expect(zoneStatus(50, 35).label).toBe('ঠিক আছে')
    expect(zoneStatus(50, 35).tone).toBe('ok')
  })
})

describe('riskInfo', () => {
  it('escalates with humidity', () => {
    expect(riskInfo(60).level).toBe('কম')
    expect(riskInfo(75).level).toBe('মাঝারি')
    expect(riskInfo(90).level).toBe('উচ্চ')
  })
  it('clamps the percentage to 5..100', () => {
    expect(riskInfo(10).pct).toBe(5)
    expect(riskInfo(100).pct).toBe(100)
  })
})

describe('fieldStage', () => {
  const field = (age: number): Field => ({
    id: 'f1', name: 'টমেটো বাগান', crop: 'টমেটো', area: 25, plants: 300, age, harvestAt: 75,
  })

  it('moves through growth stages', () => {
    expect(fieldStage(field(10)).label).toBe('চারা অবস্থা')
    expect(fieldStage(field(30)).label).toBe('বৃদ্ধির সময়')
    expect(fieldStage(field(60)).label).toBe('ফুল ও ফল ধরার সময়')
  })
  it('reports harvest time once age reaches harvestAt', () => {
    const st = fieldStage(field(75))
    expect(st.label).toBe('ফসল তোলার সময়')
    expect(st.pct).toBe(100)
  })
  it('caps progress at 100%', () => {
    expect(fieldStage(field(200)).pct).toBe(100)
  })
})

const baseState = (): FarmData => ({
  farmName: 'আমার সবজি বাগান',
  simulate: false,
  mode: 'auto',
  pumpOn: false,
  threshold: 35,
  duration: 20,
  moist: [50, 50, 50],
  valves: [true, true, true],
  tank: 80,
  humidity: 60,
  temp: 28,
  volt: 12.6,
  ack: {},
  rules: [
    { id: 'r1', text: 'বৃষ্টি হলে সেচ বাদ', on: true },
    { id: 'r2', text: 'ট্যাংক কম হলে পাম্প বন্ধ', on: true },
  ],
  schedules: [],
  irrLog: [],
  fields: [],
  scout: [],
  tasks: [],
  ledger: [],
  stock: [],
  notif: { push: false, sms: false, whatsapp: false, telegram: false },
  team: [],
})

describe('deriveAlerts', () => {
  it('is quiet when everything is fine', () => {
    expect(deriveAlerts(baseState())).toHaveLength(0)
  })
  it('raises one alert per dry zone', () => {
    const s = { ...baseState(), moist: [30, 50, 32] }
    const alerts = deriveAlerts(s)
    expect(alerts).toHaveLength(2)
    expect(alerts.map((a) => a.id)).toEqual(['dry0', 'dry2'])
  })
  it('warns about a low tank and high humidity', () => {
    const s = { ...baseState(), tank: 15, humidity: 80 }
    const ids = deriveAlerts(s).map((a) => a.id)
    expect(ids).toContain('tank')
    expect(ids).toContain('hum')
  })
  it('warns about stock below its minimum', () => {
    const s = {
      ...baseState(),
      stock: [{ id: 's1', name: 'পটাশ সার', unit: 'কেজি', qty: 6, min: 10 }],
    }
    expect(deriveAlerts(s).map((a) => a.id)).toEqual(['stock-s1'])
  })
})

describe('deriveRecs', () => {
  it('says everything is fine when there is nothing to do', () => {
    expect(deriveRecs(baseState())).toHaveLength(1)
  })
  it('suggests skipping irrigation when rain is likely and the rule is on', () => {
    const rain = FORECAST[1].rain
    const s = { ...baseState(), humidity: 60 }
    const recs = deriveRecs(s)
    const rainRec = recs.find((r) => r.id === 'rain')
    if (rain >= 60) {
      expect(rainRec?.text).toContain('বৃষ্টির সম্ভাবনা')
    } else {
      expect(rainRec).toBeUndefined()
    }
  })
  it('recommends watering a dry zone with a jump action', () => {
    const recs = deriveRecs({ ...baseState(), moist: [30, 50, 50] })
    const dry = recs.find((r) => r.id === 'dry0')
    expect(dry?.action).toEqual({ label: 'সেচ দিন', zone: 0 })
  })
  it('lists pending tasks for today', () => {
    const s = {
      ...baseState(),
      tasks: [
        { id: 't1', text: 'পাইপ দেখা', who: 'বাবা', due: 'আজ', urgent: false, done: false } satisfies Task,
      ],
    }
    expect(deriveRecs(s).some((r) => r.id === 'tasks')).toBe(true)
  })
})

describe('isLowStock', () => {
  it('is low at or below a set minimum', () => {
    expect(isLowStock({ qty: 5, min: 10 })).toBe(true)
    expect(isLowStock({ qty: 10, min: 10 })).toBe(true) // at the minimum counts (same as the server)
    expect(isLowStock({ qty: 11, min: 10 })).toBe(false)
  })
  it('never flags an item with no minimum', () => {
    expect(isLowStock({ qty: 0, min: 0 })).toBe(false)
  })
})

describe('dueFor / isOverdue', () => {
  const noon = new Date(2026, 9, 7, 12, 0).getTime() // local noon, so day arithmetic is timezone-proof
  const day = 86_400_000
  it('labels a deadline by calendar days from now', () => {
    expect(dueFor(noon + 3 * 3_600_000, noon)).toBe('আজ')
    expect(dueFor(noon - 2 * day, noon)).toBe('আজ') // past deadlines read today; they show as overdue
    expect(dueFor(noon + day, noon)).toBe('কাল')
    expect(dueFor(noon + 5 * day, noon)).toBe('এই সপ্তাহ')
    expect(dueFor(noon + 9 * day, noon)).toBe('পরে')
  })
  it('is overdue only for an open task whose deadline passed', () => {
    expect(isOverdue({ done: false, dueAt: noon - 1 }, noon)).toBe(true)
    expect(isOverdue({ done: true, dueAt: noon - 1 }, noon)).toBe(false)
    expect(isOverdue({ done: false, dueAt: noon + 1 }, noon)).toBe(false)
    expect(isOverdue({ done: false }, noon)).toBe(false) // no deadline
    expect(isOverdue({ done: false, dueAt: 0 }, noon)).toBe(false)
  })
})
