import type { EddyBranch, EddyBranchMode, EddyBranchRow } from '../../types'
import { envoyConfig } from './activation'
import { foldHome, foldOpenText } from './branch-fold'
import { paneHome } from './branch-pane'
import { envoyOnly } from './decide'
import { readJson, writeJson } from './io'
import type { Io, ToolResult } from './io'
import { NEXT_ACTION_PREFIX } from './next-action'
import { teamDir } from './paths'
import { readCards } from './questions'

const MAX_CLAIM_TRIES = 20

/** A refusal of a home or of the switch step: the text goes to the caller as it is. */
export type Refusal = { refused: string }

/**
 * One mode of a branch (its home). Each method answers a refusal or a value (plan 5.4):
 * `busy` null when the branch may move, `collect` the rows the home holds, `enter` the new owner and the text
 * the caller reads, `leave` null when the old home let go.
 */
export type BranchHome = {
  busy: (rec: EddyBranch) => Promise<Refusal | null>
  collect: (rec: EddyBranch) => Promise<EddyBranchRow[] | Refusal>
  enter: (rec: EddyBranch) => Promise<{ owner: string; text: string } | Refusal>
  leave: (rec: EddyBranch) => Promise<Refusal | null>
}
export type BranchHomes = Record<EddyBranchMode, BranchHome>

/** The two homes of the spike. T5 fills the fold home, T6 the pane home. */
export const HOMES: BranchHomes = { fold: foldHome, pane: paneHome }

const fail = (result: string): ToolResult => ({ result, isError: true })

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

const BRANCH_ID = /^B-\d+$/

export const branchesDir = (teamdir: string) => `${teamdir}/branches`

const branchNumber = (name: string) => /^B-(\d+)\.json$/.exec(name)?.[1]

/** The text `branch_open` puts first in its result and the mod uses to find where a fold branch begins. */
export const markerOf = (id: string, card: string) => `EDDY-BRANCH-OPEN ${id} on ${card}`

export const readBranch = (io: Io, teamdir: string, id: string) =>
  readJson<EddyBranch>(io, `${branchesDir(teamdir)}/${id}.json`)

export const writeBranch = (io: Io, teamdir: string, rec: EddyBranch) =>
  writeJson(io, `${branchesDir(teamdir)}/${rec.id}.json`, rec)

/** Every record with `state: 'open'`. One branch at a time is the rule; more than one is a lost race. */
async function openBranches(io: Io, teamdir: string): Promise<EddyBranch[]> {
  const dir = branchesDir(teamdir)
  const found: EddyBranch[] = []
  for (const name of await io.list(dir)) {
    if (!branchNumber(name)) continue
    const rec = await readJson<EddyBranch>(io, `${dir}/${name}`)
    if (rec?.state === 'open') found.push(rec)
  }
  return found
}

/** The one record with `state: 'open'`, or null. One branch at a time. */
export async function openBranch(io: Io, teamdir: string): Promise<EddyBranch | null> {
  return (await openBranches(io, teamdir))[0] ?? null
}

/** Takes the next free branch number. A claim is a directory: mkdir fails when the path exists. */
async function claimBranch(io: Io, teamdir: string): Promise<number | null> {
  const dir = branchesDir(teamdir)
  await io.run(['mkdir', '-p', `${dir}/claims`])
  const taken = [...(await io.list(dir)).map(branchNumber), ...(await io.list(`${dir}/claims`))]
    .map(n => Number(n))
    .filter(n => Number.isInteger(n))
  let n = Math.max(0, ...taken) + 1
  for (let tries = 0; tries < MAX_CLAIM_TRIES; tries++, n++) {
    if ((await io.run(['mkdir', `${dir}/claims/${n}`])).exitCode === 0) return n
  }
  return null
}

/** Who calls: the session, and whether it holds the envoy role. */
export type Caller = { session: string; envoy: boolean }

const callerOf = async (io: Io): Promise<Caller> => ({
  session: await io.sessionId(), envoy: (await envoyConfig(io)) !== null,
})

/** The human prompt that opened the branch: the newest user row with text, no tool result, and not a mod message. */
async function openingPrompt(io: Io): Promise<string> {
  const rows = await io.messages()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.role !== 'user' || row.text.trim() === '' || (row.toolResults?.length ?? 0) > 0) continue
    if (row.text.startsWith(NEXT_ACTION_PREFIX)) continue
    return row.text.slice(0, 60)
  }
  return ''
}

export async function branchOpenTool(io: Io, input: unknown): Promise<ToolResult> {
  const cfg = await envoyOnly(io, 'branch_open')
  if ('result' in cfg) return cfg
  const v = (input ?? {}) as { card?: unknown; mode?: unknown }
  if (typeof v.card !== 'string' || !/^Q-\d+$/.test(v.card)) return fail('card must be a Q-<n> id')
  if (v.mode !== 'fold' && v.mode !== 'pane') return fail('mode must be fold or pane')
  const teamdir = await teamDir(io)
  const open = await openBranch(io, teamdir)
  if (open) return fail(`${open.id} is already open on ${open.card}: close it first, one branch at a time`)
  const card = (await readCards(io, teamdir)).find(c => c.id === v.card)
  if (!card) return fail(`no card ${v.card}`)
  if (card.status !== 'open' && card.status !== 'assumed') {
    return fail(`${card.id} is ${card.status}: only an open or parked card can be discussed`)
  }
  if (v.mode === 'pane') return fail('pane mode not built yet')
  const n = await claimBranch(io, teamdir)
  if (n === null) return fail(`no free branch number after ${MAX_CLAIM_TRIES} tries`)
  const session = await io.sessionId()
  const now = await io.now()
  const id = `B-${n}`
  const rec: EddyBranch = {
    id, n, card: card.id,
    seed: {
      context: card.context, question: card.question, options: card.options, recommendation: card.recommendation,
      refs: card.refs, blocks: card.blocks, door: card.door, rework: card.rework,
    },
    mode: v.mode, owner: session, envoy: session, state: 'open',
    mark: markerOf(id, card.id), opened_by: await openingPrompt(io), base: 0, history: [],
    note: { leaning: '', own_options: [], open_points: [] }, agents: [],
    log: [{ from: 'none', to: v.mode, at: now }], opened_at: now,
  }
  await writeBranch(io, teamdir, rec)
  // Two calls in one turn can both pass the check above. After the write each looks again: the lowest number
  // keeps the branch, every other open record drops itself and refuses with the id that stays.
  const keeper = (await openBranches(io, teamdir)).reduce((a, b) => (b.n < a.n ? b : a), rec)
  if (keeper.id !== rec.id) {
    await writeBranch(io, teamdir, { ...rec, state: 'dropped', closed_at: await io.now() })
    return fail(`${keeper.id} is already open on ${keeper.card}: close it first, one branch at a time`)
  }
  return { result: foldOpenText(rec) }
}

const stringList = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

export async function branchNoteTool(io: Io, input: unknown): Promise<ToolResult> {
  const v = (input ?? {}) as { id?: unknown; leaning?: unknown; own_options?: unknown; open_points?: unknown }
  if (typeof v.id !== 'string' || !BRANCH_ID.test(v.id)) return fail('id must be a B-<n> id')
  if (v.leaning !== undefined && typeof v.leaning !== 'string') return fail('leaning must be text')
  if (v.own_options !== undefined && !stringList(v.own_options)) return fail('own_options must be a list of text')
  if (v.open_points !== undefined && !stringList(v.open_points)) return fail('open_points must be a list of text')
  const teamdir = await teamDir(io)
  const rec = await readBranch(io, teamdir, v.id)
  if (!rec || rec.state !== 'open') return fail(`no open branch ${v.id}`)
  if (rec.owner !== (await io.sessionId())) {
    return fail(`${rec.id} lives in ${rec.mode} mode: only its owner writes its note`)
  }
  const note = {
    leaning: v.leaning ?? rec.note.leaning,
    own_options: v.own_options ?? rec.note.own_options,
    open_points: v.open_points ?? rec.note.open_points,
  }
  await writeBranch(io, teamdir, { ...rec, note })
  return { result: `Noted on ${rec.id}` }
}

export async function branchModeTool(io: Io, input: unknown): Promise<ToolResult> {
  const v = (input ?? {}) as { id?: unknown; mode?: unknown }
  if (typeof v.id !== 'string' || !BRANCH_ID.test(v.id)) return fail('id must be a B-<n> id')
  if (v.mode !== 'fold' && v.mode !== 'pane') return fail('mode must be fold or pane')
  const done = await switchBranch(io, v.id, v.mode, await callerOf(io), HOMES)
  return 'refused' in done ? fail(done.refused) : { result: done.text }
}

/** Only the owner settles, and only a pane branch has an owner other than the envoy: T6 builds it. */
export async function branchSettleTool(): Promise<ToolResult> {
  return fail('pane mode not built yet')
}

export async function branchCloseTool(io: Io, input: unknown): Promise<ToolResult> {
  const cfg = await envoyOnly(io, 'branch_close')
  if ('result' in cfg) return cfg
  const v = (input ?? {}) as { id?: unknown; outcome?: unknown; summary?: unknown }
  if (typeof v.id !== 'string' || !BRANCH_ID.test(v.id)) return fail('id must be a B-<n> id')
  if (v.outcome !== 'settled' && v.outcome !== 'dropped') return fail('outcome must be settled or dropped')
  const teamdir = await teamDir(io)
  const rec = await readBranch(io, teamdir, v.id)
  if (!rec || rec.state !== 'open') return fail(`no open branch ${v.id}`)
  const closed_at = await io.now()
  const question = `${rec.seed.question} (${rec.card})`
  if (v.outcome === 'dropped') {
    await writeBranch(io, teamdir, { ...rec, state: 'dropped', closed_at, ...(isText(v.summary) ? { summary: v.summary } : {}) })
    return { result: `Branch ${rec.id} on ${question} dropped. Back at the trunk.` }
  }
  if (!isText(v.summary)) return fail('summary is required to settle a branch')
  const card = (await readCards(io, teamdir)).find(c => c.id === rec.card)
  if (card?.status !== 'answered' || card.decision === undefined) {
    return fail(`${rec.card} is not answered yet: call decide first, then branch_close`)
  }
  const summary = v.summary.trim().replace(/\.+$/, '')
  await writeBranch(io, teamdir, { ...rec, state: 'settled', summary, decision: card.decision, closed_at })
  return { result: `Back from the branch on ${question}: ${summary}. Recorded as decision ${card.decision}.` }
}

/** Text for the `/eddy-branch` command. */
export async function branchStatus(io: Io): Promise<string> {
  const open = await openBranch(io, await teamDir(io))
  return open
    ? `Branch ${open.id} is open on ${open.card} (${open.mode}). News waits until it closes.`
    : 'No eddy branch is open.'
}

/**
 * The switch step (plan 5.4): move an open branch to another mode. The home it leaves must not be busy, hands over
 * its rows, and the new home names the new owner. A refusal of the new home puts the record back as it was.
 */
export async function switchBranch(
  io: Io, id: string, to: EddyBranchMode, caller: Caller, homes: BranchHomes,
): Promise<{ text: string } | Refusal> {
  const teamdir = await teamDir(io)
  const before = await readBranch(io, teamdir, id)
  if (!before || before.state !== 'open') return { refused: `no open branch ${id}` }
  if (before.mode === to) return { refused: `${id} is already in ${to} mode` }
  if (!caller.envoy && caller.session !== before.owner) {
    return { refused: `${id} lives in ${before.mode} mode: only the envoy or its owner may move it` }
  }
  const from = homes[before.mode]
  const busy = await from.busy(before)
  if (busy) return busy
  const history = await from.collect(before)
  if (!Array.isArray(history)) return history
  const moved: EddyBranch = {
    ...before, mode: to, history, base: history.length,
    log: [...before.log, { from: before.mode, to, at: await io.now() }],
  }
  await writeBranch(io, teamdir, moved)
  // A refusal and a throw of the new home both put the record back as step 1 read it.
  const entered = await homes[to].enter(moved).catch((e: unknown): Refusal => ({
    refused: `${to} mode could not start: ${e instanceof Error ? e.message : String(e)}`,
  }))
  if ('refused' in entered) {
    await writeBranch(io, teamdir, before)
    return entered
  }
  await writeBranch(io, teamdir, { ...moved, owner: entered.owner })
  await from.leave(moved)
  return { text: entered.text }
}

const ID_PROP = { type: 'string', description: 'The branch id, B-<n>.' }
const MODE_PROP = { type: 'string', enum: ['fold', 'pane'] }

export const BRANCH_OPEN_SPEC = {
  name: 'branch_open',
  description:
    'Open a branch on one card to discuss it away from the trunk. Envoy session only. One branch at a time. ' +
    'Mode fold: the discussion stays in this chat. News waits until branch_close.',
  inputSchema: {
    type: 'object',
    properties: { card: { type: 'string', description: 'The card id, Q-<n>.' }, mode: MODE_PROP },
    required: ['card', 'mode'],
  },
}

export const BRANCH_NOTE_SPEC = {
  name: 'branch_note',
  description:
    'Write down where the discussion stands: the leaning, the human\'s own options, the open points. ' +
    'Each field you pass replaces the old one. Only the session that owns the branch.',
  inputSchema: {
    type: 'object',
    properties: {
      id: ID_PROP,
      leaning: { type: 'string' },
      own_options: { type: 'array', items: { type: 'string' } },
      open_points: { type: 'array', items: { type: 'string' } },
    },
    required: ['id'],
  },
}

export const BRANCH_MODE_SPEC = {
  name: 'branch_mode',
  description: 'Move an open branch to the other mode (fold: this chat, pane: a separate session). Envoy or owner.',
  inputSchema: { type: 'object', properties: { id: ID_PROP, mode: MODE_PROP }, required: ['id', 'mode'] },
}

export const BRANCH_SETTLE_SPEC = {
  name: 'branch_settle',
  description: 'Hand the human\'s answer from a pane branch back to the envoy. Only the owner of a pane branch.',
  inputSchema: {
    type: 'object',
    properties: {
      id: ID_PROP,
      answer: { type: 'string', description: 'The answer the human gave.' },
      summary: { type: 'string', description: 'One line: what the discussion found.' },
    },
    required: ['id', 'answer', 'summary'],
  },
}

export const BRANCH_CLOSE_SPEC = {
  name: 'branch_close',
  description:
    'Close an open branch. settled: call decide for its card first; the result is the line to tell the human. ' +
    'dropped: no decision. Envoy session only.',
  inputSchema: {
    type: 'object',
    properties: {
      id: ID_PROP,
      outcome: { type: 'string', enum: ['settled', 'dropped'] },
      summary: { type: 'string', description: 'One line. Required for settled.' },
    },
    required: ['id', 'outcome'],
  },
}
