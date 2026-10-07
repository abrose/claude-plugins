import type { TeamCard } from '../../types'
import { readRecords } from './tick'
import { readJson, writeJson } from './io'
import type { Io, ToolResult } from './io'
import { buildCard, checkAsk } from './cards'
import type { AskInput } from './cards'
import { teamDir } from './paths'

const MAX_CLAIM_TRIES = 20

export const questionsDir = (teamdir: string) => `${teamdir}/questions`

const fail = (result: string): ToolResult => ({ result, isError: true })

const cardNumber = (name: string) => /^Q-(\d+)\.json$/.exec(name)?.[1]

export async function readCards(io: Io, teamdir: string): Promise<TeamCard[]> {
  const dir = questionsDir(teamdir)
  const cards: TeamCard[] = []
  for (const name of await io.list(dir)) {
    if (!cardNumber(name)) continue
    const card = await readJson<TeamCard>(io, `${dir}/${name}`)
    if (card) cards.push(card)
  }
  return cards.sort((a, b) => a.n - b.n)
}

export async function writeCard(io: Io, teamdir: string, card: TeamCard): Promise<void> {
  await writeJson(io, `${questionsDir(teamdir)}/${card.id}.json`, card)
}

/** Takes the next free card number. A claim is a directory: mkdir fails when the path exists. */
export async function claimNumber(io: Io, teamdir: string): Promise<number | null> {
  const dir = questionsDir(teamdir)
  await io.run(['mkdir', '-p', `${dir}/claims`])
  const taken = [...(await io.list(dir)).map(cardNumber), ...(await io.list(`${dir}/claims`))]
    .map(n => Number(n))
    .filter(n => Number.isInteger(n))
  let n = Math.max(0, ...taken) + 1
  for (let tries = 0; tries < MAX_CLAIM_TRIES; tries++, n++) {
    if ((await io.run(['mkdir', `${dir}/claims/${n}`])).exitCode === 0) return n
  }
  return null
}

async function asker(io: Io, teamdir: string): Promise<{ from: string; tag: string } | null> {
  const session = await io.sessionId()
  const records = await readRecords(io, teamdir)
  for (const [name, rec] of Object.entries(records)) {
    if (rec.session === session) return { from: name, tag: rec.topic || 'general' }
  }
  const cfg = await readJson<{ orchestrator: string; orchestrator_session?: string }>(io, `${teamdir}/config.json`)
  if (cfg?.orchestrator_session === session) return { from: cfg.orchestrator, tag: 'general' }
  return null
}

export async function askTool(io: Io, input: unknown): Promise<ToolResult> {
  const teamdir = await teamDir(io)
  const who = await asker(io, teamdir)
  if (!who) return fail('ask works only in a team session (an agent started by team-start, or the orchestrator)')
  const bad = checkAsk(input)
  if (bad) return fail(bad)
  const n = await claimNumber(io, teamdir)
  if (n === null) return fail(`no free card number after ${MAX_CLAIM_TRIES} tries`)
  await writeCard(io, teamdir, buildCard(input as AskInput, n, who.from, who.tag, await io.now()))
  return { result: `Q-${n}` }
}

export const ASK_TOOL_SPEC = {
  name: 'ask',
  description:
    'File an open question for the human as a card. State door and rework; park (parked: true) only a ' +
    'two-way question with about an hour of rework or less, and continue on your recommendation. ' +
    'Returns the card id, Q-<n>; name it in your REPORT line.',
  inputSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', description: 'What the human needs to know to decide.' },
      question: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: { option: { type: 'string' }, cost: { type: 'string' } },
          required: ['option', 'cost'],
        },
      },
      recommendation: { type: 'string', description: 'Your pick and why.' },
      blocks: { type: 'string', description: 'What waits on the answer.' },
      door: { type: 'string', enum: ['one-way', 'two-way'] },
      rework: { type: 'string', description: 'Cost to undo the wrong pick, with its size.' },
      parked: { type: 'boolean', description: 'true: continue on your recommendation without waiting.' },
      urgent: { type: 'boolean' },
      refs: { type: 'array', items: { type: 'string' } },
    },
    required: ['context', 'question', 'options', 'recommendation', 'blocks', 'door', 'rework', 'parked'],
  },
}
