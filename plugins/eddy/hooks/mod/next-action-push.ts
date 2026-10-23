import type { EddyNewsHold, TeamAgentRow, TeamCard, TeamPlan } from '../../types'
import type { TeamConfig } from './activation'
import { readDenials } from './denial'
import { bySession, herdrDialog } from './herdr'
import type { HerdrListing } from './herdr'
import { newsHolds, passedNews } from './holds'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import {
  carryDialogs, changeList, draftHeld, nextActionBlock, nextActionDue, nextActionPrompt, nextActionView, triggersOf,
} from './next-action'
import type { DraftMark, NextActionInput, NextActionMarks, NextActionSnapshot } from './next-action'
import type { TeamRecord } from './tick'

/** A turn that never reported its end stops holding the message after this long (a lost `turn.complete`). */
const BUSY_STALE_MS = 10 * 60_000

type Stored = NextActionMarks & { draft: DraftMark | null }

// Memory only, and reset on every session.start: a reload starts over, and so does a test.
let busySince: number | null = null
let lastView: { key: string; snapshot: NextActionSnapshot } | null = null

export const noteTurnStart = (now: number) => {
  busySince = now
}
export const noteTurnEnd = () => {
  busySince = null
}
export const resetNextAction = () => {
  busySince = null
  lastView = null
}

const isBusy = (now: number) => busySince !== null && now - busySince < BUSY_STALE_MS

export const marksPath = (teamdir: string) => `${teamdir}/next-action.json`

function isStored(v: unknown): v is Stored {
  const s = v as Stored | null
  return typeof s?.key === 'string' && typeof s.snapshot === 'object' && s.snapshot !== null
    && Array.isArray(s.snapshot.open) && Array.isArray(s.snapshot.denials) && Array.isArray(s.snapshot.closed)
}

/** What the next-action block and the change list read, from what the envoy tick already holds. */
export async function gatherInput(io: Io, from: {
  run: string
  cfg: TeamConfig
  teamdir: string
  records: Record<string, TeamRecord>
  rows: TeamAgentRow[]
  listed: HerdrListing
  cards: TeamCard[]
  plan: TeamPlan | null
  stalled: boolean
  myId: string
  now: number
  /** Dialogs this tick already read, pane to text: a blocked agent in it is not read again. */
  dialogs?: Map<string, string>
  /** The holds in force now (`newsHolds`). */
  holds?: EddyNewsHold[]
}): Promise<NextActionInput> {
  const agents: NextActionInput['agents'] = []
  const filers: NextActionInput['filers'] = []
  for (const row of from.rows) {
    const rec = from.records[row.name]
    if (!rec || rec.session === from.myId) continue
    if (rec.role === 'orchestrator') {
      filers.push({ name: row.name, role: rec.role, pane: row.pane })
      continue
    }
    const briefedAt = rec.brief ? await io.mtime(`${from.run}/brief-${row.name}-${rec.topic}.md`) : null
    const read = from.dialogs?.get(row.pane)
    agents.push({
      name: row.name, role: rec.role, pane: row.pane, topic: rec.topic, state: row.state,
      briefed: !!rec.brief, briefedAt,
      dialog: row.state === 'blocked' ? (read ?? await herdrDialog(io, row.pane)) : '',
    })
  }
  const orchestrator = from.cfg.orchestrator_session
  return {
    cards: from.cards,
    plan: from.plan,
    agents,
    filers,
    orchestratorGone: from.listed.ok && !!orchestrator && !bySession(from.listed.agents).has(orchestrator),
    stalled: from.stalled,
    denials: (await readDenials(io, from.teamdir)).map(d => ({ name: d.name, tool: d.tool, at: d.at })),
    holds: from.holds ?? [],
    now: from.now,
  }
}

/**
 * One envoy tick of the next-action message. The first tick of the role only writes the baseline. Later ticks
 * keep the burst and the draft marks, and submit a NEXT-ACTION prompt when one is due and the envoy is idle
 * and its prompt box holds no draft (an urgent message waits only for a draft that still changes). The marks
 * are written as sent before the submit; a rejected submit puts them back, so the next tick tries again.
 * Returns how many changes wait behind a hold (0 when no hold is in force). A message that passes a hold tells
 * the passing news only; the count then holds the changes that stay.
 */
export async function pushNextAction(io: Io, teamdir: string, input: NextActionInput): Promise<number> {
  const fromInput = nextActionView(input)
  lastView = { key: fromInput.key, snapshot: fromInput.snapshot }
  const path = marksPath(teamdir)
  const read = await readJson<unknown>(io, path)
  if (!isStored(read)) {
    await writeJson(io, path, { key: fromInput.key, snapshot: fromInput.snapshot, pending: null, draft: null } satisfies Stored)
    return 0
  }
  // A failed dialog read must not store an empty dialog: it would match any later prompt of that worker.
  const view = { ...fromInput, snapshot: carryDialogs(fromInput.snapshot, read.snapshot) }
  lastView = { key: view.key, snapshot: view.snapshot }
  const stored: Stored = { ...read, draft: read.draft ?? null }
  const draft = draftHeld(stored.draft, await io.draft(), triggersOf(stored.snapshot, view.snapshot).urgent)
  const due = nextActionDue(stored, view, input.now)
  // A tick that sends nothing still fills an empty dialog of the stored snapshot with the one read now (fill only,
  // never replace; no trigger, so no message). The send tick of a worker's first block may have had a failed read.
  const kept: Stored = {
    key: stored.key, snapshot: carryDialogs(stored.snapshot, view.snapshot), pending: due.pending, draft: draft.mark,
  }
  // A hold keeps the message back, with its burst marks, unless the change is one of the three kinds that pass
  // (decision 26). A message that passes tells only those changes: the snapshot it leaves behind (`sent`) holds
  // them alone, so every other change stays a change and goes out in the one message after the last hold lifts.
  const holding = (input.holds?.length ?? 0) > 0
  const passed = holding ? passedNews(stored.snapshot, view.snapshot, input.cards) : null
  if (!due.due || isBusy(input.now) || draft.held || (holding && passed === null)) {
    if (JSON.stringify(kept) !== JSON.stringify(stored)) await writeJson(io, path, kept)
    return holding ? changeList(stored.snapshot, input).length : 0
  }
  const sent = passed ?? view.snapshot
  const changes = changeList(stored.snapshot, input)
  const held = passed === null ? [] : changeList(passed, input)
  // The lines of the changes that wait come off the list one by one (a line can repeat).
  const told = [...changes]
  for (const line of held) {
    const at = told.indexOf(line)
    if (at >= 0) told.splice(at, 1)
  }
  // The block of a partial message names the passing cards only: a held card stays out of it, or the envoy would
  // tell it mid-branch. An open card stays when it passes (`passed.open`), a parked one when an earlier message
  // told it (`passed.parked`). Today the block reads open cards only, so the parked rule is a guard for a block that
  // lists parked cards one day. The block after the last hold lifts lists every card as before.
  const shown = (c: TeamCard) => c.status === 'open'
    ? passed?.open.includes(c.id)
    : c.status !== 'assumed' || passed?.parked.includes(c.id)
  const block = passed === null ? view.block : nextActionBlock({ ...input, cards: input.cards.filter(shown) })
  const text = nextActionPrompt(block, told)
  // The key stays the old one while news waits: the waiting change must still count as due once the hold lifts.
  const key = passed === null ? view.key : stored.key
  await writeJson(io, path, { key, snapshot: sent, pending: null, draft: draft.mark } satisfies Stored)
  // Not awaited: the submit settles whenever the session takes the prompt, and a tick must end before that.
  void io.submit(text).catch(() => writeJson(io, path, kept).catch(() => undefined))
  return held.length
}

/**
 * A `queue` call showed the human's cards to the envoy: the state of the last tick counts as sent. While a hold is
 * in force it counts for the cards alone (the ids the envoy saw); every other held change stays a change against the
 * stored snapshot, and the stored key stays, so the one message after the last hold lifts still tells them.
 */
export async function markShown(io: Io, teamdir: string): Promise<void> {
  if (lastView === null) return
  const read = await readJson<unknown>(io, marksPath(teamdir))
  if (!isStored(read)) return
  if ((await newsHolds(io)).length === 0) {
    await writeJson(io, marksPath(teamdir), { ...read, key: lastView.key, snapshot: lastView.snapshot, pending: null })
    return
  }
  const seen = lastView.snapshot
  const both = (a: string[], b: string[]) => [...a, ...b.filter(id => !a.includes(id))]
  const snapshot: NextActionSnapshot = {
    ...read.snapshot,
    open: both(read.snapshot.open, seen.open),
    parked: both(read.snapshot.parked, seen.parked),
    urgent: seen.urgent,
    linked: seen.linked,
  }
  await writeJson(io, marksPath(teamdir), { ...read, snapshot })
}
