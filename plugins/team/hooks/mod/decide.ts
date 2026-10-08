import type { TeamCard } from '../../types'
import { envoyConfig } from './activation'
import type { TeamConfig } from './activation'
import { queueGroups } from './cards'
import { writeJson } from './io'
import type { Io, ToolResult } from './io'
import { runDir, teamDir } from './paths'
import { readCards, writeCard } from './questions'

export type DecisionEntry = {
  n: number
  cards: { id: string; from: string; tag: string }[]
  answer: string
  rationale: string
  overrides: string[]
  at: number
}

const fail = (result: string): ToolResult => ({ result, isError: true })

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** The run config, or the refusal when this session does not hold the envoy role. */
export async function envoyOnly(io: Io, tool: string): Promise<TeamConfig | ToolResult> {
  return (await envoyConfig(io)) ?? fail(`${tool} works only in the envoy session`)
}

export async function queueTool(io: Io, input: unknown): Promise<ToolResult> {
  const cfg = await envoyOnly(io, 'queue')
  if ('result' in cfg) return cfg
  const tag = (input as { tag?: unknown } | null)?.tag
  const cards = await readCards(io, await teamDir(io))
  return { result: JSON.stringify({ groups: queueGroups(cards, typeof tag === 'string' ? tag : undefined) }) }
}

/** 1 + the highest decision number in the file, amendments (3a) counted under their number. */
export function nextDecision(text: string): number {
  const numbers = [...text.matchAll(/^(\d+)[a-z]?\.\s/gm)].map(m => Number(m[1]))
  return Math.max(0, ...numbers) + 1
}

export const decisionParagraph = (n: number, date: string, answer: string, rationale: string, ids: string[]) =>
  `${n}. (${date}) ${answer} Why: ${rationale} Cards: ${ids.join(', ')}.\n`

type DecideInput =
  | { obsolete: true; cards: string[]; reason: string }
  | { obsolete: false; cards: string[]; answer: string; rationale: string; overrides: string[] }

function checkDecide(input: unknown): DecideInput | string {
  const v = (input ?? {}) as Record<string, unknown>
  const ids = v.cards
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string' && /^Q-\d+$/.test(id))) {
    return 'cards must list at least one Q-<n> id'
  }
  const listed = v.overrides ?? []
  if (!Array.isArray(listed) || !listed.every((id): id is string => typeof id === 'string')) {
    return 'overrides must list Q-<n> ids'
  }
  const overrides = [...new Set<string>(listed)]
  const cards = [...new Set<string>(ids)]
  if (v.obsolete === true) {
    if (!isText(v.reason)) return 'reason is required to mark cards obsolete'
    return { obsolete: true, cards, reason: v.reason }
  }
  if (!isText(v.answer) || !isText(v.rationale)) return 'answer and rationale are required'
  // U+2028 and U+2029 count as line breaks: with the m flag, `^` matches after them (nextDecision).
  if (/[\r\n\u{2028}\u{2029}]/u.test(v.answer)) return 'answer must be one line'
  if (/[\r\n\u{2028}\u{2029}]/u.test(v.rationale)) return 'rationale must be one line'
  return { obsolete: false, cards, answer: v.answer, rationale: v.rationale, overrides }
}

const unusable = (card: TeamCard) =>
  card.status === 'answered' ? `${card.id} is already answered (decision ${card.decision})`
    : card.status === 'obsolete' ? `${card.id} is already obsolete`
      : null

// One chain for the module: two calls in flight run one at a time, so each reads the
// decisions file after the one before it has written. A failed call must not break the chain.
let decideChain: Promise<unknown> = Promise.resolve()

export function decideTool(io: Io, input: unknown): Promise<ToolResult> {
  const run = decideChain.then(() => decideOnce(io, input))
  decideChain = run.catch(() => undefined)
  return run
}

async function decideOnce(io: Io, input: unknown): Promise<ToolResult> {
  const cfg = await envoyOnly(io, 'decide')
  if ('result' in cfg) return cfg
  const checked = checkDecide(input)
  if (typeof checked === 'string') return fail(checked)

  const teamdir = await teamDir(io)
  const byId = new Map((await readCards(io, teamdir)).map(c => [c.id, c]))
  const picked: TeamCard[] = []
  for (const id of checked.cards) {
    const card = byId.get(id)
    if (!card) return fail(`no card ${id}`)
    const bad = unusable(card)
    if (bad) return fail(bad)
    picked.push(card)
  }

  if (checked.obsolete) {
    for (const card of picked) await writeCard(io, teamdir, { ...card, status: 'obsolete', reason: checked.reason })
    return { result: `Obsolete: ${checked.cards.join(', ')}` }
  }

  for (const id of checked.overrides) {
    if (byId.get(id)?.status !== 'assumed' || !checked.cards.includes(id)) {
      return fail(`${id} is not an assumed card of this decision`)
    }
  }
  const { answer, rationale, overrides } = checked
  const path = `${await runDir(io)}/decisions-${cfg.ticket}.md`
  const text = await io.readText(path)
  if (text === null) return fail(`no decisions file: ${path}`)

  const n = nextDecision(text)
  const now = await io.now()
  const date = new Date(now).toISOString().slice(0, 10)
  const paragraph = decisionParagraph(n, date, answer, rationale, checked.cards)
  // Not atomic, by decision 31: paragraph, then ledger, then cards. If a write throws after the
  // paragraph, the file holds a paragraph with no ledger entry (no DECISION line), the cards stay
  // open, and a retry appends a second paragraph under the next number.
  await io.writeText(path, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${paragraph}`)

  const entry: DecisionEntry = {
    n,
    cards: picked.map(c => ({ id: c.id, from: c.from, tag: c.tag })),
    answer,
    rationale,
    overrides,
    at: now,
  }
  await writeJson(io, `${teamdir}/decisions/${n}.json`, entry)
  for (const card of picked) await writeCard(io, teamdir, { ...card, status: 'answered', decision: n })
  return { result: `Decision ${n}` }
}

export const QUEUE_TOOL_SPEC = {
  name: 'queue',
  description: 'List the open and assumed cards grouped by tag, most pressing first. Envoy session only.',
  inputSchema: {
    type: 'object',
    properties: { tag: { type: 'string', description: 'Only this group.' } },
  },
}

export const DECIDE_TOOL_SPEC = {
  name: 'decide',
  description:
    'Close cards with one numbered decision, or mark them obsolete. List in overrides the assumed cards ' +
    'whose assumption this answer changes. Envoy session only. Returns "Decision <n>".',
  inputSchema: {
    type: 'object',
    properties: {
      cards: { type: 'array', items: { type: 'string' }, description: 'Card ids, Q-<n>.' },
      answer: { type: 'string', description: 'The decision, as the human gave it.' },
      rationale: { type: 'string', description: 'Why, in one sentence.' },
      overrides: { type: 'array', items: { type: 'string' }, description: 'Assumed cards this answer changes.' },
      obsolete: { type: 'boolean', description: 'true: mark the cards obsolete instead of answering them.' },
      reason: { type: 'string', description: 'Why the cards are obsolete.' },
    },
    required: ['cards'],
  },
}
