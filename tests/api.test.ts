import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { HindsightClient } from '@vectorize-io/hindsight-client'
import { createApp } from '../server/app.js'
import { buildGroundedBrief } from '../server/briefing.js'

const captured: Array<{ operation: string; bankId: string; values: unknown[] }> = []
const demoMemory = { id: 'm1', text: 'Employee A mentioned considering buying next month | When: 2026-09-28 | Involving: Rahul (employee-A) | Rahul may consider buying next month | Rahul asked about a 20% discount | Rahul is concerned about the price | Rahul likes the product but is concerned about the price', type: 'world', context: 'conversation', metadata: { employee_id: 'employee-A' }, mentioned_at: '2026-09-28T10:00:00Z', document_id: 'demo-1' }
let recalledMemories = [demoMemory]
let server: Server
let origin = ''

const client = {
  getVersion: async () => ({ api_version: 'test' }),
  createBank: async (bankId: string) => {
    captured.push({ operation: 'createBank', bankId, values: [] })
    return {} as never
  },
  retain: async (bankId: string, content: string, options: unknown) => {
    captured.push({ operation: 'retain', bankId, values: [content, options] })
    return {} as never
  },
  recall: async (bankId: string, query: string, options: unknown) => {
    captured.push({ operation: 'recall', bankId, values: [query, options] })
    return { results: recalledMemories } as never
  },
  reflect: async (bankId: string, _query: string, options: unknown) => {
    captured.push({ operation: 'reflect', bankId, values: [options] })
    return {
      text: recalledMemories.length ? 'A teammate discussed Rahul’s product interest. A 20% discount is not confirmed. He may consider buying later.' : 'No relevant customer history was found.',
      structured_output: { currentSituation: recalledMemories.length ? 'Interested; price is a concern.' : 'No relevant customer history was found.', previousDiscussions: recalledMemories.length ? ['20% discount requested'] : [], openItems: [], possibleNextSteps: recalledMemories.length ? ['Rahul may consider buying next month.'] : [] },
      based_on: { memories: recalledMemories.map((memory) => ({ id: memory.id })), mental_models: [], directives: [] },
    } as never
  },
} as unknown as HindsightClient

before(async () => {
  server = createServer(createApp(client))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address && typeof address !== 'string') origin = `http://127.0.0.1:${address.port}`
})

after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))

test('lists fictional demo customers', async () => {
  const response = await fetch(`${origin}/api/customers`)
  const values = await response.json() as Array<{ id: string }>
  assert.equal(response.status, 200)
  assert.deepEqual(values.map((value) => value.id), ['CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'CUST-005'])
})

test('creates a new customer with a dedicated bank and memory record', async () => {
  const response = await fetch(`${origin}/api/customers`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Aisha Khan', company: 'Northwind Labs', product: 'CRM platform' }),
  })
  assert.equal(response.status, 201)
  const created = await response.json() as { id: string; name: string; company: string; conversation: string }
  assert.equal(created.name, 'Aisha Khan')
  assert.equal(created.company, 'Northwind Labs')
  assert.match(created.id, /^CUST-/)
  assert.match(created.conversation, /Aisha/i)

  const listResponse = await fetch(`${origin}/api/customers`)
  assert.equal(listResponse.status, 200)
  const list = await listResponse.json() as Array<{ id: string; name: string }>
  assert.ok(list.some((customer) => customer.id === created.id && customer.name === 'Aisha Khan'))
})

test('allows Vite dev origins for local frontend requests', async () => {
  const response = await fetch(`${origin}/api/customers`, {
    headers: { Origin: 'http://localhost:5174' },
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5174')
})

test('retains customer conversation with employee and source provenance', async () => {
  const response = await fetch(`${origin}/api/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001', employee: 'A', transcript: 'Rahul likes the product.' }),
  })
  assert.equal(response.status, 201)
  const retain = captured.findLast((call) => call.operation === 'retain')
    assert.ok(retain)
    assert.equal(retain.bankId, 'teammind-cust-001')
    const options = retain.values[1] as { metadata: Record<string, string>; tags: string[] }
  assert.equal(options.metadata.employee_id, 'employee-A')
  assert.ok(options.tags.includes('customer:CUST-001'))
})

test('supports full customer memory CRUD on the local API', async () => {
  const createResponse = await fetch(`${origin}/api/customers/CUST-001/memories`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Manual note: Rahul wants a weekly summary.', employee: 'B' }),
  })
  assert.equal(createResponse.status, 201)
  const created = await createResponse.json() as { id: string; text: string; employee: string }
  assert.equal(created.employee, 'Employee B')
  assert.match(created.text, /weekly summary/i)

  const listResponse = await fetch(`${origin}/api/customers/CUST-001/memories`)
  assert.equal(listResponse.status, 200)
  const list = await listResponse.json() as Array<{ id: string; text: string }>
  assert.ok(list.some((item) => item.id === created.id))

  const updateResponse = await fetch(`${origin}/api/customers/CUST-001/memories/${created.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Manual note: Rahul wants a weekly summary and a low-friction rollout.', employee: 'A' }),
  })
  assert.equal(updateResponse.status, 200)
  const updated = await updateResponse.json() as { text: string; employee: string }
  assert.match(updated.text, /low-friction rollout/i)
  assert.equal(updated.employee, 'Employee A')

  const deleteResponse = await fetch(`${origin}/api/customers/CUST-001/memories/${created.id}`, { method: 'DELETE' })
  assert.equal(deleteResponse.status, 200)
  const deleted = await deleteResponse.json() as { deleted: boolean }
  assert.equal(deleted.deleted, true)
})

test('Employee B gets a strict customer-scoped recall and uncertainty warning', async () => {
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001' }),
  })
  const brief = await response.json() as { openItems: Array<{ reason: string }>; memories: Array<{ employee: string }>; answer: { possibleNextSteps: string[] } }
  assert.equal(response.status, 200)
  assert.match(brief.openItems[0]?.reason ?? '', /Unconfirmed/)
  assert.equal(brief.memories[0]?.employee, 'Employee A')
  assert.match(brief.answer.possibleNextSteps[0] ?? '', /may consider/)
  assert.doesNotMatch(brief.answer.possibleNextSteps.join(' '), /will buy/)
  const recall = captured.findLast((call) => call.operation === 'recall')
    assert.ok(recall)
    assert.equal(recall.bankId, 'teammind-cust-001')
    assert.deepEqual((recall.values[1] as { tags: string[]; tagsMatch: string }).tags, ['customer:CUST-001'])
    assert.equal((recall.values[1] as { tagsMatch: string }).tagsMatch, 'all_strict')
})

  test('local brief uses strict Hindsight recall without invoking reflect', async () => {
    let reflected = false
    const app = createApp({
      ...client,
      reflect: async () => {
        reflected = true
        throw new Error('local mode should not depend on Hindsight tool calling')
      },
    } as unknown as HindsightClient, { localMode: true })
    const localServer = createServer(app)
    await new Promise<void>((resolve) => localServer.listen(0, '127.0.0.1', resolve))
    const address = localServer.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/brief`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'CUST-001' }),
    })
    const brief = await response.json() as { grounded: boolean; answer: { possibleNextSteps: string[] }; openItems: Array<{ reason: string }> }
    assert.equal(response.status, 200)
    assert.equal(brief.grounded, true)
    assert.match(brief.answer.possibleNextSteps[0] ?? '', /may consider/)
    assert.ok(brief.openItems.some((item) => /Unconfirmed/.test(item.reason)))
    assert.equal(reflected, false)
    await new Promise<void>((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()))
  })

  test('local brief uses only exact recalled facts and does not turn may-buy into a commitment', () => {
    const answer = buildGroundedBrief('Rahul Sharma', [demoMemory])
    assert.equal(answer.currentSituation, 'Rahul likes the product but is concerned about the price')
    assert.ok(answer.previousDiscussions.some((fact) => /asked about a 20% discount/.test(fact)))
    assert.ok(answer.possibleNextSteps.includes('Rahul may consider buying next month'))
    assert.doesNotMatch(answer.possibleNextSteps.join(' '), /will buy/)
  })

test('does not call Hindsight for an unknown customer bank', async () => {
  const previousLength = captured.length
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-999' }),
  })
  assert.equal(response.status, 404)
  assert.equal(captured.length, previousLength)
})

test('rejects empty conversation content', async () => {
  const response = await fetch(`${origin}/api/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001', employee: 'A', transcript: '   ' }),
  })
  assert.equal(response.status, 400)
})

test('returns a service error instead of hiding Hindsight failures', async () => {
  const brokenApp = createApp({ ...client, recall: async () => { throw new Error('backend offline') } } as unknown as HindsightClient)
  const brokenServer = createServer(brokenApp)
  await new Promise<void>((resolve) => brokenServer.listen(0, '127.0.0.1', resolve))
  const address = brokenServer.address()
  assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001' }),
  })
  assert.equal(response.status, 502)
  assert.match((await response.json() as { error: string }).error, /Hindsight connection/)
  await new Promise<void>((resolve, reject) => brokenServer.close((error) => error ? reject(error) : resolve()))
})

test('explains when Hindsight credits block a retain', async () => {
  const creditError = Object.assign(new Error('Insufficient credits'), { name: 'HindsightError', statusCode: 402 })
  const creditApp = createApp({
    ...client,
    createBank: async () => ({}),
    retain: async () => { throw creditError },
  } as unknown as HindsightClient)
  const creditServer = createServer(creditApp)
  await new Promise<void>((resolve) => creditServer.listen(0, '127.0.0.1', resolve))
  const address = creditServer.address()
  assert.ok(address && typeof address !== 'string')
  const response = await fetch(`http://127.0.0.1:${address.port}/api/conversations`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001', employee: 'A', transcript: 'Rahul likes the product.' }),
  })
  assert.equal(response.status, 502)
  assert.match((await response.json() as { error: string }).error, /insufficient credits/i)
  await new Promise<void>((resolve, reject) => creditServer.close((error) => error ? reject(error) : resolve()))
})

test('keeps a rejected or unapproved discount marked as unresolved', async () => {
  recalledMemories = [{ ...demoMemory, text: 'Rahul asked whether a 20% discount was possible, but it was not approved.' }]
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001' }),
  })
  const brief = await response.json() as { openItems: Array<{ reason: string }> }
  assert.equal(response.status, 200)
  assert.ok(brief.openItems.some((item) => /Unconfirmed/.test(item.reason)))
  recalledMemories = [demoMemory]
})

test('detects unresolved status even when recall omits the request wording', async () => {
  recalledMemories = [{ ...demoMemory, text: 'The 20% discount is not confirmed.' }]
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001' }),
  })
  const brief = await response.json() as { openItems: Array<{ reason: string }> }
  assert.equal(response.status, 200)
  assert.ok(brief.openItems.some((item) => /Unconfirmed/.test(item.reason)))
  recalledMemories = [demoMemory]
})

test('does not warn when the retrieved history records explicit discount approval', async () => {
  recalledMemories = [{ ...demoMemory, text: 'Rahul requested a 20% discount. The team approved the discount.' }]
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-001' }),
  })
  const brief = await response.json() as { openItems: Array<{ item: string }> }
  assert.equal(response.status, 200)
  assert.equal(brief.openItems.length, 0)
  recalledMemories = [demoMemory]
})

test('reports missing history without attaching another customer memory', async () => {
  recalledMemories = []
  const response = await fetch(`${origin}/api/brief`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customerId: 'CUST-002' }),
  })
  const brief = await response.json() as { grounded: boolean; memories: unknown[]; answer: { currentSituation: string } }
  assert.equal(response.status, 200)
  assert.equal(brief.grounded, false)
  assert.deepEqual(brief.memories, [])
  assert.match(brief.answer.currentSituation, /No relevant customer history/)
  recalledMemories = [demoMemory]
})