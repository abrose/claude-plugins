import type { TeamCard } from '../../types'

export type AskInput = Omit<
  TeamCard,
  'id' | 'n' | 'from' | 'tag' | 'status' | 'decision' | 'reason' | 'at' | 'urgent' | 'refs'
> & { urgent?: boolean; refs?: string[]; parked: boolean }

const REQUIRED_TEXT = ['context', 'question', 'recommendation', 'blocks', 'rework'] as const

const isText = (v: unknown) => typeof v === 'string' && v.trim() !== ''

/** The first thing wrong with an ask input, or null when it is a card. */
export function checkAsk(input: unknown): string | null {
  const v = (input ?? {}) as Record<string, unknown>
  for (const field of REQUIRED_TEXT) {
    if (!isText(v[field])) return `${field} is required`
  }
  const options = v.options
  const wellFormed =
    Array.isArray(options) &&
    options.length > 0 &&
    options.every(o => typeof o?.option === 'string' && typeof o?.cost === 'string')
  if (!wellFormed) return 'options need at least one { option, cost }'
  if (v.door !== 'one-way' && v.door !== 'two-way') return 'door must be one-way or two-way'
  if (typeof v.parked !== 'boolean') return 'parked must be true or false'
  if (v.door === 'one-way' && v.parked) return 'a one-way card cannot be parked: wait for the answer'
  return null
}

export function buildCard(input: AskInput, n: number, from: string, tag: string, at: number): TeamCard {
  return {
    id: `Q-${n}`,
    n,
    from,
    tag,
    context: input.context,
    question: input.question,
    options: input.options,
    recommendation: input.recommendation,
    blocks: input.blocks,
    door: input.door,
    rework: input.rework,
    urgent: input.urgent ?? false,
    refs: input.refs ?? [],
    status: input.parked ? 'assumed' : 'open',
    at,
  }
}
