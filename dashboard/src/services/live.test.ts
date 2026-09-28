import { describe, expect, it } from 'vitest'
import { parseSSE } from '@/services/live'

describe('parseSSE', () => {
  it('splits complete events and keeps the unfinished rest', () => {
    const { events, rest } = parseSSE('retry: 3000\n\nevent: farm\ndata: {"tank":5}\n\n: ping\n\nevent: alerts\ndata: {')
    expect(events).toEqual([{ name: 'farm', data: '{"tank":5}' }])
    expect(rest).toBe('event: alerts\ndata: {')
  })

  it('reassembles an event split across chunks', () => {
    const first = parseSSE('event: telemetry\nda')
    const second = parseSSE(first.rest + 'ta: {"id":1}\n\n')
    expect(first.events).toEqual([])
    expect(second.events).toEqual([{ name: 'telemetry', data: '{"id":1}' }])
    expect(second.rest).toBe('')
  })

  it('accepts CRLF line endings', () => {
    expect(parseSSE('event: devices\r\ndata: {}\r\n\r\n').events).toEqual([{ name: 'devices', data: '{}' }])
  })
})
