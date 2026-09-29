import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import type { HindsightClient } from '@vectorize-io/hindsight-client'
import { briefSchema, buildGroundedBrief, type BriefAnswer } from './briefing.js'
import { addCustomer, bankIdFor, customerTag, customers, findCustomer } from './customers.js'

type MemoryClient = Pick<HindsightClient, 'getVersion' | 'createBank' | 'retain' | 'recall' | 'reflect'>

const retainMission = 'Remember customer preferences, needs, objections, questions, issues, and follow-ups. Preserve the customer’s exact level of certainty. A request is not an agreement; a possibility is not a commitment.'
const reflectMission = 'Brief the next teammate using only retrieved customer memories. Separate confirmed facts from requests, possibilities, and unresolved items. Never invent a customer statement or turn a possible future action into a promise.'

const conversationSchema = z.object({
  customerId: z.string().min(1),
  employee: z.enum(['A', 'B']),
  transcript: z.string().trim().min(1).max(12000),
})

const customerSchema = z.object({ customerId: z.string().min(1) })

function safeErrorMessage(error: unknown): string {
  const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
    ? error.statusCode
    : undefined
  if (statusCode === 402) {
    return 'Hindsight Cloud has insufficient credits to store this conversation. Add credits to the Hindsight account, then retry.'
  }
  if (error instanceof Error && error.name === 'HindsightError') {
    return 'Hindsight could not complete that memory operation. Check the Hindsight service and its model configuration, then try again.'
  }
  return 'The memory service is unavailable. Check your Hindsight connection and try again.'
}

function unavailable(response: Response, error: unknown) {
  console.error('Hindsight request failed:', error)
  return response.status(502).json({ error: safeErrorMessage(error) })
}

async function ensureCustomerBank(client: MemoryClient, customerId: string) {
  await client.createBank(bankIdFor(customerId), {
    name: `TeamMind ${customerId}`,
    retainMission,
    reflectMission,
  })
}

function isUnconfirmedRequest(memories: Array<{ text: string }>) {
  const content = memories.map((memory) => memory.text).join(' ').toLowerCase()
  const mentionsDiscount = /\b(discount|price reduction|off)\b/.test(content)
  const requestLanguage = /\b(ask(?:ed)?|request(?:ed)?|possible|possibility|discuss(?:ed|ion)?|might|may|could)\b/.test(content)
  const unresolvedLanguage = /\b(not confirmed|unconfirmed|not approved|not agreed|pending(?: approval)?|not finalized)\b/.test(content)
  const explicitAgreement = content.split(/[.!?]+/).some((statement) => {
    const mentionsAgreement = /\b(discount|price reduction)\b.{0,45}\b(approved|confirmed|agreed|granted|accepted)\b/.test(statement)
      || /\b(approved|confirmed|agreed|granted|accepted)\b.{0,45}\b(discount|price reduction)\b/.test(statement)
    const negatesAgreement = /\b(not|never|isn't|wasn't|hasn't|unconfirmed|pending)\b.{0,24}\b(approved|confirmed|agreed|granted|accepted)\b/.test(statement)
    return mentionsAgreement && !negatesAgreement
  })
  if (!mentionsDiscount || (!requestLanguage && !unresolvedLanguage) || explicitAgreement) return []
  return [{
    item: 'A discount was requested or discussed, but no approval is recorded.',
    reason: 'Unconfirmed. Verify with the team before promising a discount.',
  }]
}

type ManualMemory = {
  id: string
  customerId: string
  text: string
  employee: 'Employee A' | 'Employee B' | 'Team'
  source: string
  type: 'manual'
  context: string
  timestamp: string
}

function normalizeManualEmployee(employee?: string): ManualMemory['employee'] {
  switch (employee?.toUpperCase()) {
    case 'A':
    case 'EMPLOYEE-A':
      return 'Employee A'
    case 'B':
    case 'EMPLOYEE-B':
      return 'Employee B'
    default:
      return 'Team'
  }
}

export function createApp(client: MemoryClient, options: { localMode?: boolean } = {}) {
  const app = express()
  const configuredOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const allowedOrigins = new Set(configuredOrigins)
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin) || localhostPattern.test(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('CORS origin not allowed for TeamMind'))
    },
    credentials: true,
  }))
  app.use(express.json({ limit: '32kb' }))

  const manualMemoryStore = new Map<string, ManualMemory[]>()

  app.get('/api/customers', (_request, response) => response.json(customers))

  app.post('/api/customers', async (request: Request, response: Response) => {
    const parsed = z.object({
      name: z.string().trim().min(1),
      company: z.string().trim().min(1),
      product: z.string().trim().min(1),
      conversation: z.string().trim().min(1).optional(),
      preview: z.string().trim().optional(),
    }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Provide a customer name, company, and product.' })

    const { name, company, product, conversation, preview } = parsed.data
    const customer = addCustomer({ name, company, product, conversation, preview })

    try {
      await ensureCustomerBank(client, customer.id)
      await client.retain(bankIdFor(customer.id), customer.conversation, {
        timestamp: new Date().toISOString(),
        context: `New customer profile created for ${customer.name} (${customer.id}) in TeamMind.`,
        documentId: `new-customer-${customer.id.toLowerCase()}`,
        metadata: {
          customer_id: customer.id,
          employee_id: 'employee-A',
          source: 'customer creation',
          conversation_id: `new-customer-${customer.id.toLowerCase()}`,
        },
        tags: [customerTag(customer.id), 'employee:A'],
        observationScopes: 'shared',
        async: false,
      })
      return response.status(201).json(customer)
    } catch (error) {
      return unavailable(response, error)
    }
  })

  app.get('/api/customers/:customerId/memories', (request, response) => {
    const customer = findCustomer(request.params.customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })
    return response.json(manualMemoryStore.get(customer.id) ?? [])
  })

  app.post('/api/customers/:customerId/memories', (request, response) => {
    const customer = findCustomer(request.params.customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })

    const parsed = z.object({
      text: z.string().trim().min(1),
      employee: z.string().optional(),
      source: z.string().trim().min(1).optional(),
    }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Add a memory note before saving it.' })

    const memory: ManualMemory = {
      id: crypto.randomUUID(),
      customerId: customer.id,
      text: parsed.data.text,
      employee: normalizeManualEmployee(parsed.data.employee),
      source: parsed.data.source ?? 'manual note',
      type: 'manual',
      context: `Manual update for ${customer.name} (${customer.id}).`,
      timestamp: new Date().toISOString(),
    }

    const existing = manualMemoryStore.get(customer.id) ?? []
    const next = [memory, ...existing]
    manualMemoryStore.set(customer.id, next)
    return response.status(201).json(memory)
  })

  app.put('/api/customers/:customerId/memories/:memoryId', (request, response) => {
    const customer = findCustomer(request.params.customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })

    const parsed = z.object({
      text: z.string().trim().min(1),
      employee: z.string().optional(),
      source: z.string().trim().min(1).optional(),
    }).safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Update the memory note before saving it.' })

    const existing = manualMemoryStore.get(customer.id) ?? []
    const index = existing.findIndex((memory) => memory.id === request.params.memoryId)
    if (index === -1) return response.status(404).json({ error: 'That memory note was not found.' })

    const updated: ManualMemory = {
      ...existing[index],
      text: parsed.data.text,
      employee: normalizeManualEmployee(parsed.data.employee),
      source: parsed.data.source ?? existing[index].source,
      timestamp: new Date().toISOString(),
    }
    existing[index] = updated
    manualMemoryStore.set(customer.id, existing)
    return response.json(updated)
  })

  app.delete('/api/customers/:customerId/memories/:memoryId', (request, response) => {
    const customer = findCustomer(request.params.customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })

    const existing = manualMemoryStore.get(customer.id) ?? []
    const next = existing.filter((memory) => memory.id !== request.params.memoryId)
    manualMemoryStore.set(customer.id, next)
    return response.json({ deleted: next.length !== existing.length })
  })

  app.get('/api/status', async (_request, response) => {
    try {
      const version = await client.getVersion()
      return response.json({ connected: true, version: version.api_version })
    } catch {
      return response.json({ connected: false, version: null })
    }
  })

  app.post('/api/conversations', async (request: Request, response: Response) => {
    const parsed = conversationSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Add a customer, choose an employee, and enter a conversation.' })

    const { customerId, employee, transcript } = parsed.data
    const customer = findCustomer(customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })

    const id = crypto.randomUUID()
    const occurredAt = new Date().toISOString()
    try {
      const bankId = bankIdFor(customer.id)
      await ensureCustomerBank(client, customer.id)
      await client.retain(bankId, transcript, {
        timestamp: occurredAt,
        context: `Fictional customer conversation with ${customer.name} (${customer.id}). Employee ${employee} is speaking with the customer; preserve which statements are proposals, possibilities, and confirmed agreements.`,
        documentId: id,
        metadata: {
          customer_id: customer.id,
          employee_id: `employee-${employee}`,
          source: 'conversation',
          conversation_id: id,
        },
        tags: [customerTag(customer.id), `employee:${employee}`],
        observationScopes: 'shared',
        async: false,
      })
      return response.status(201).json({
        conversationId: id,
        customerId: customer.id,
        employee,
        timestamp: occurredAt,
        stored: true,
      })
    } catch (error) {
      return unavailable(response, error)
    }
  })

  app.post('/api/brief', async (request: Request, response: Response) => {
    const parsed = customerSchema.safeParse(request.body)
    if (!parsed.success) return response.status(400).json({ error: 'Select a customer before requesting a brief.' })
    const customer = findCustomer(parsed.data.customerId)
    if (!customer) return response.status(404).json({ error: 'That customer is not in the demo workspace.' })

    const bankId = bankIdFor(customer.id)
    const scope = { tags: [customerTag(customer.id)], tagsMatch: 'all_strict' as const }
    try {
      await ensureCustomerBank(client, customer.id)
      const recall = await client.recall(
        bankId,
        `Customer history for ${customer.name}: product interest, preferences, price objections, requests or offers, support issues, follow-ups, commitments, and any open or uncertain items. Retrieve the relevant facts from different employee conversations.`,
        { ...scope, budget: 'mid', maxTokens: 3000, includeChunks: false },
      )
      const memories = recall.results.map((memory) => ({
        id: memory.id,
        text: memory.text,
        type: memory.type,
        context: memory.context,
        timestamp: memory.mentioned_at ?? memory.occurred_start ?? null,
        employee: memory.metadata?.employee_id === 'employee-A' ? 'Employee A' : memory.metadata?.employee_id === 'employee-B' ? 'Employee B' : 'Team',
        source: memory.metadata?.source ?? 'conversation',
        conversationId: memory.document_id ?? null,
      }))

      let answer: BriefAnswer | null
      let text: string
      let grounded: boolean
      if (options.localMode) {
        answer = buildGroundedBrief(customer.name, memories)
        text = answer.currentSituation
        grounded = recall.results.length > 0
      } else {
        const reflection = await client.reflect(
          bankId,
          `Brief a teammate taking over ${customer.name} at ${customer.company}. Summarize current situation and relevant prior discussions. Label proposals, requests, and possible actions as unconfirmed. Never say a purchase will happen unless the memory records a firm commitment. If the bank has no relevant history, say so.`,
          { ...scope, budget: 'mid', responseSchema: briefSchema, includeFacts: true },
        )
        answer = reflection.structured_output as BriefAnswer | null
        text = reflection.text
        grounded = (reflection.based_on?.memories?.length ?? 0) > 0
      }
      const openItems = [
        ...isUnconfirmedRequest(recall.results),
        ...(answer?.openItems ?? []),
      ]
      const uniqueOpenItems = [...new Map(openItems.map((item) => [`${item.item}|${item.reason}`, item])).values()]
      return response.json({
        customerId: customer.id,
        answer,
        text,
        openItems: uniqueOpenItems,
        memories,
        grounded,
      })
    } catch (error) {
      return unavailable(response, error)
    }
  })

  app.post('/api/demo/seed', async (_request, response) => {
    const results: Array<{ customerId: string; stored: boolean }> = []
    try {
      for (const customer of customers) {
        const bankId = bankIdFor(customer.id)
        await ensureCustomerBank(client, customer.id)
        await client.retain(bankId, customer.conversation, {
          timestamp: new Date().toISOString(),
          context: `Fictional customer handoff conversation. Employee A spoke with ${customer.name} (${customer.id}). Preserve uncertainty and unresolved status; a possible future action is not a promise.`,
          documentId: `demo-${customer.id.toLowerCase()}-handoff-v1`,
          metadata: {
            customer_id: customer.id,
            employee_id: 'employee-A',
            source: 'demo conversation',
            conversation_id: `demo-${customer.id.toLowerCase()}-handoff-v1`,
          },
          tags: [customerTag(customer.id), 'employee:A'],
          observationScopes: 'shared',
          async: false,
        })
        results.push({ customerId: customer.id, stored: true })
      }
      return response.json({ results })
    } catch (error) {
      return unavailable(response, error)
    }
  })

  return app
}