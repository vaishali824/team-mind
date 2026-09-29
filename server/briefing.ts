import { z } from 'zod'

export const briefSchema = {
  type: 'object',
  properties: {
    currentSituation: { type: 'string' },
    previousDiscussions: { type: 'array', items: { type: 'string' } },
    openItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { item: { type: 'string' }, reason: { type: 'string' } },
        required: ['item', 'reason'],
        additionalProperties: false,
      },
    },
    possibleNextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['currentSituation', 'previousDiscussions', 'openItems', 'possibleNextSteps'],
  additionalProperties: false,
} as const

export const briefAnswerSchema = z.object({
  currentSituation: z.string(),
  previousDiscussions: z.array(z.string()),
  openItems: z.array(z.object({ item: z.string(), reason: z.string() })),
  possibleNextSteps: z.array(z.string()),
})

export type BriefAnswer = z.infer<typeof briefAnswerSchema>

export interface BriefMemoryInput {
  text: string
}

export function buildGroundedBrief(customerName: string, memories: BriefMemoryInput[]): BriefAnswer {
  const facts = [...new Set(memories.flatMap(({ text }) => text
    .split(/\s+\|\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment && !/^(when|involving):/i.test(segment))))]

  if (facts.length === 0) {
    return {
      currentSituation: `No relevant customer history is available for ${customerName}.`,
      previousDiscussions: [],
      openItems: [],
      possibleNextSteps: [],
    }
  }

  const interestAndConcern = facts.find((fact) =>
    /\b(like|likes|love|loves|interested|interest)\b/i.test(fact)
    && /\b(price|expensive|cost|concern|objection)\b/i.test(fact),
  )
  const interest = facts.find((fact) => /\b(like|likes|love|loves|interested|interest|prefer|prefers)\b/i.test(fact))
  const concern = facts.find((fact) => /\b(price|expensive|cost|concern|issue|problem|competitor|compare|support|follow.?up)\b/i.test(fact))
  const currentSituation = interestAndConcern
    ?? ([interest, concern].filter((fact): fact is string => Boolean(fact)).join(' ') || facts[0])

  const previousDiscussions = facts
    .filter((fact) => /\b(discount|competitor|compare|support|issue|problem|import|follow.?up|prefer|likes?|loves?|interested|price|expensive|concern)\b/i.test(fact))
    .slice(0, 6)

  const possibleNextSteps = facts
    .filter((fact) => /\b(may|might|could|possibly|possible|consider(?:ing)?|follow.?up)\b/i.test(fact))
    .sort((left, right) => {
      const leftIsExplicit = /\b(may|might|could|possibly|possible)\b/i.test(left) ? 0 : 1
      const rightIsExplicit = /\b(may|might|could|possibly|possible)\b/i.test(right) ? 0 : 1
      return leftIsExplicit - rightIsExplicit || left.localeCompare(right)
    })
    .slice(0, 3)

  return {
    currentSituation: currentSituation || facts[0],
    previousDiscussions,
    openItems: [],
    possibleNextSteps,
  }
}
