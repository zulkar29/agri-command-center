// Run with: node --test src/lib/outbox.test.ts   (Node 22.18+ strips the types itself)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify, enqueue, isOffline, mergeQueued, newClientId, pendingIds, type QueuedWrite } from './outbox.ts'

const post = (id: string, over: Partial<QueuedWrite> = {}): QueuedWrite => ({
  clientId: id, collection: 'tasks', method: 'POST', path: '/tasks',
  body: { id, text: `task ${id}`, who: 'আমি', due: 'আজ', urgent: false }, queuedAt: 1000, ...over,
})
const patch = (id: string, body: Record<string, unknown>, at = 2000): QueuedWrite => ({
  clientId: id, collection: 'tasks', method: 'PATCH', path: `/tasks/${id}`, body, queuedAt: at,
})

test('classify: what a failed send means', () => {
  assert.equal(classify('POST', 201), 'sent')
  assert.equal(classify('PATCH', 200), 'sent')
  assert.equal(classify('POST', 409), 'sent') // the server already has it — a replay, not a failure
  assert.equal(classify('PATCH', 409), 'drop')
  for (const s of [0, 500, 502, 503, 401, 408, 429]) assert.equal(classify('POST', s), 'retry', `status ${s}`)
  for (const s of [400, 403, 404, 422]) assert.equal(classify('POST', s), 'drop', `status ${s}`)
  assert.ok(isOffline(0) && !isOffline(500))
})

test('newClientId: valid for the server and (practically) unique', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newClientId()))
  assert.equal(ids.size, 500)
  for (const id of ids) assert.match(id, /^[A-Za-z0-9-]{6,40}$/)
  assert.equal(newClientId(0, () => 0), 'm-0-000000')
})

test('enqueue: consecutive patches to one row collapse, others keep their order', () => {
  let q: QueuedWrite[] = []
  q = enqueue(q, post('a1b2c3'))
  q = enqueue(q, patch('a1b2c3', { done: true }, 2000))
  q = enqueue(q, patch('a1b2c3', { done: false }, 3000)) // toggled back offline
  assert.equal(q.length, 2)
  assert.deepEqual(q[1].body, { done: false })
  assert.equal(q[1].queuedAt, 3000)
  q = enqueue(q, patch('zzzzzz', { done: true }))
  assert.equal(q.length, 3)
  assert.deepEqual(q.map((w) => w.method), ['POST', 'PATCH', 'PATCH'])
  // a create is never merged away
  assert.equal(enqueue(q, post('b1b2b3')).length, 4)
})

test('mergeQueued: queued creates show first, once, and the server copy wins when it arrives', () => {
  const server = [{ id: 's1', text: 'server', done: false }]
  const q = [post('n1', { queuedAt: 10 }), post('n2', { queuedAt: 20 })]
  const merged = mergeQueued(server as { id: string; text?: string; done?: boolean }[], q, 'tasks')
  assert.deepEqual(merged.map((x) => x.id), ['n2', 'n1', 's1']) // newest queued first
  assert.equal(merged[0].done, false)
  // once the server has n1 (a replay landed), it is not shown twice
  const after = mergeQueued([{ id: 'n1', text: 'task n1', done: false }, ...server], q, 'tasks')
  assert.equal(after.filter((x) => x.id === 'n1').length, 1)
})

test('mergeQueued: a queued tick applies to server rows and to queued creates', () => {
  const server = [{ id: 's1', text: 'server', done: false }]
  const q = [post('n1'), patch('s1', { done: true }), patch('n1', { done: true })]
  const merged = mergeQueued(server as { id: string; done?: boolean }[], q, 'tasks')
  assert.deepEqual(merged.map((x) => [x.id, x.done]), [['n1', true], ['s1', true]])
})

test('mergeQueued: other collections are untouched; ledger/observations default their time', () => {
  const server = [{ id: 's1' }]
  assert.equal(mergeQueued(server, [post('n1')], 'ledger'), server) // same reference: nothing to merge
  const led: QueuedWrite = { clientId: 'l1l1l1', collection: 'ledger', method: 'POST', path: '/ledger', body: { id: 'l1l1l1', type: 'expense', amount: 5 }, queuedAt: 777 }
  const out = mergeQueued([] as { id: string; at?: number }[], [led], 'ledger')
  assert.equal(out[0].at, 777)
})

test('pendingIds covers creates and changes', () => {
  assert.deepEqual([...pendingIds([post('a1b2c3'), patch('s1', {})])].sort(), ['a1b2c3', 's1'])
})
