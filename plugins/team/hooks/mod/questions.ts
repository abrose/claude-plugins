import type { TeamCard } from '../../types'
import { bySession, herdrAgents, herdrDialog } from './herdr'
import { readRecords } from './tick'
import { readJson, writeJson } from './io'
import type { Io, ToolResult } from './io'
import { buildCard, checkAsk } from './cards'
import type { AskInput } from './cards'
import { freshDenial } from './denial'
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

async function asker(io: Io, teamdir: string): Promise<{ from: string; tag: string; topic: string } | null> {
  const session = await io.sessionId()
  const records = await readRecords(io, teamdir)
  for (const [name, rec] of Object.entries(records)) {
    if (rec.session === session) return { from: name, tag: rec.topic || 'general', topic: rec.topic }
  }
  const cfg = await readJson<{ orchestrator: string; orchestrator_session?: string }>(io, `${teamdir}/config.json`)
  if (cfg?.orchestrator_session === session) return { from: cfg.orchestrator, tag: 'general', topic: '' }
  return null
}

type Approval = { kind: 'none' } | { kind: 'number'; n: number } | { kind: 'invalid' }

/** What a filer wrote in `approved_by`: nothing, a decision number, or a value that is no positive whole number. */
const approvedBy = (input: unknown): Approval => {
  const raw = (input as { approved_by?: unknown }).approved_by
  if (raw === undefined || raw === null || raw === '') return { kind: 'none' }
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? { kind: 'number', n: raw } : { kind: 'invalid' }
}

/**
 * What the tool knows that makes a card urgent, beyond the filer's own `urgent`: a fresh auto-mode denial of
 * the filer, and a decision the filer names in `approved_by`. Each reason adds one line to the context. A bad
 * `approved_by` never refuses the card: a blocked worker must still reach the human, so it only warns.
 */
async function urgency(
  io: Io, teamdir: string, who: { from: string; topic: string }, input: unknown,
): Promise<{ urgent: boolean; notes: string[]; warning: string }> {
  const notes: string[] = []
  let urgent = (input as { urgent?: unknown }).urgent === true
  const denial = await freshDenial(io, teamdir, who.from, who.topic)
  if (denial) {
    const minutes = Math.floor(((await io.now()) - denial.at) / 60_000)
    const ago = minutes < 1 ? 'less than 1 min' : `${minutes} min`
    notes.push(`The tool marked this card urgent: auto mode denied \`${denial.tool}\` ${ago} before it.`)
    urgent = true
  }
  const approval = approvedBy(input)
  if (approval.kind === 'none') return { urgent, notes, warning: '' }
  if (approval.kind === 'number' && (await io.readText(`${teamdir}/decisions/${approval.n}.json`)) !== null) {
    notes.push(`The tool marked this card urgent: it blocks work approved in decision ${approval.n}.`)
    return { urgent: true, notes, warning: '' }
  }
  const problem = approval.kind === 'number'
    ? `approved_by names decision ${approval.n}, which does not exist`
    : 'approved_by is not a decision number (a positive whole number)'
  notes.push(`${problem}.`)
  return { urgent, notes, warning: `\nWarning: ${problem}. It did not make the card urgent.` }
}

/** The herdr calls the tool makes while it files a prompt card each get this much time (design OQ8). */
const PROMPT_READ_MS = 3000

type PromptLink =
  | { refused: string }
  | { prompt: TeamCard['prompt']; notes: string[]; warning: string }

/**
 * What `prompt_of` makes of a card: the link to the worker's permission prompt, as the tool sees the prompt
 * now. The filer gives one fact, the agent's name. A name that is no team agent, or the filer itself, refuses
 * the card (a typo, safe to refile at once). The agent's state never refuses it: a blocked worker must still
 * reach the human. A prompt the tool cannot see (not blocked, herdr down, read failed) files an empty
 * fingerprint, and the stale rule closes the card when the prompt is gone.
 */
async function promptLink(io: Io, teamdir: string, who: { from: string }, input: unknown): Promise<PromptLink> {
  const raw = (input as { prompt_of?: unknown }).prompt_of
  if (raw === undefined || raw === null || raw === '') return { prompt: undefined, notes: [], warning: '' }
  if (typeof raw !== 'string') return { refused: 'prompt_of must be the name of a team agent' }
  if (raw === who.from) return { refused: `prompt_of names the filer itself: ${raw}` }
  const rec = (await readRecords(io, teamdir))[raw]
  if (!rec) return { refused: `prompt_of names no team agent: ${raw}` }

  const listed = await herdrAgents(io, PROMPT_READ_MS)
  const agent = listed.ok && rec.session ? bySession(listed.agents).get(rec.session) : undefined
  const pane = agent?.pane_id ?? rec.pane
  const blocked = agent?.agent_status === 'blocked'
  const dialog = blocked ? await herdrDialog(io, pane, PROMPT_READ_MS) : ''
  const prompt = { agent: raw, role: rec.role, session: rec.session ?? '', pane, dialog, at: await io.now() }
  const notes = [
    `The tool linked this card to the permission prompt of the ${rec.role} (${pane}). ` +
    'It closes by itself when that prompt is gone.',
  ]
  if (!listed.ok) {
    const warning = `\nWarning: herdr did not answer (${listed.reason}), so the prompt of ${raw} was not read. The card is linked anyway.`
    return { prompt, notes, warning }
  }
  const warning = blocked
    ? ''
    : `\nWarning: ${raw} shows no permission prompt now. The card closes by itself in about 30 s unless one shows.`
  return { prompt, notes, warning }
}

export async function askTool(io: Io, input: unknown): Promise<ToolResult> {
  const teamdir = await teamDir(io)
  const who = await asker(io, teamdir)
  if (!who) return fail('ask works only in a team session (an agent started by team-start, or the orchestrator)')
  const bad = checkAsk(input)
  if (bad) return fail(bad)
  const link = await promptLink(io, teamdir, who, input)
  if ('refused' in link) return fail(link.refused)
  const n = await claimNumber(io, teamdir)
  if (n === null) return fail(`no free card number after ${MAX_CLAIM_TRIES} tries`)
  const ask = input as AskInput
  const found = await urgency(io, teamdir, who, input)
  const notes = [...found.notes, ...link.notes]
  const context = notes.length > 0 ? `${ask.context}\n${notes.join('\n')}` : ask.context
  const card = buildCard(
    { ...ask, context, urgent: found.urgent, prompt: link.prompt }, n, who.from, who.tag, await io.now())
  await writeCard(io, teamdir, card)
  return { result: `Q-${n}${found.warning}${link.warning}` }
}

export const ASK_TOOL_SPEC = {
  name: 'ask',
  description:
    'File an open question for the human as a card. State door and rework; park (parked: true) only a ' +
    'two-way question with about an hour of rework or less, and continue on your recommendation. ' +
    'Returns the card id, Q-<n>; name it in your REPORT line. Write the card so it stands on its own. ' +
    'A reader who saw nothing else in the conversation must be able to decide.',
  inputSchema: {
    type: 'object',
    properties: {
      context: {
        type: 'string',
        description:
          'Open with one background line: what the thing is and why it matters. Then each finding, ' +
          'starting with a headline that states its effect. Give a file path, id or tool name only ' +
          'after its plain meaning, in parentheses.',
      },
      question: {
        type: 'string',
        description: 'The question in plain words. It is the card title. Not an artifact name.',
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            option: {
              type: 'string',
              description:
                'The option named by its meaning. Say what it does and what it does not do. ' +
                'Never a bare letter or id.',
            },
            cost: { type: 'string', description: 'What choosing this option costs, with its size.' },
          },
          required: ['option', 'cost'],
        },
      },
      recommendation: {
        type: 'string',
        description: 'The option you recommend, by its name, and why in one sentence.',
      },
      blocks: { type: 'string', description: 'What waits on the answer.' },
      door: {
        type: 'string',
        enum: ['one-way', 'two-way'],
        description: 'one-way: hard to undo. two-way: you can switch later.',
      },
      rework: { type: 'string', description: 'Cost to undo the wrong pick, with its size.' },
      parked: { type: 'boolean', description: 'true: continue on your recommendation without waiting.' },
      urgent: { type: 'boolean' },
      refs: { type: 'array', items: { type: 'string' } },
      approved_by: {
        type: 'integer',
        description:
          'The number of the decision that approved the work this card is about. The tool marks the card ' +
          'urgent when that decision exists. Leave it out when no decision approved the work.',
      },
      prompt_of: {
        type: 'string',
        description:
          'Set it on a card about a worker\'s permission prompt: the name of that worker, from the WATCH ' +
          'line. The tool reads the prompt itself and links the card to it. The card then closes by itself ' +
          'when the prompt is gone. Leave it out on every other card.',
      },
    },
    required: ['context', 'question', 'options', 'recommendation', 'blocks', 'door', 'rework', 'parked'],
  },
}
