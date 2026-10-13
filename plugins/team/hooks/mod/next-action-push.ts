import type { TeamAgentRow, TeamCard, TeamPlan } from '../../types'
import type { TeamConfig } from './activation'
import { readDenials } from './denial'
import { bySession, herdrDialog } from './herdr'
import type { HerdrListing } from './herdr'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { changeList, draftHeld, nextActionDue, nextActionPrompt, nextActionView } from './next-action'
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
    && Array.isArray(s.snapshot.open) && Array.isArray(s.snapshot.denials)
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
    agents.push({
      name: row.name, role: rec.role, pane: row.pane, topic: rec.topic, state: row.state,
      briefed: !!rec.brief, briefedAt, dialog: row.state === 'blocked' ? await herdrDialog(io, row.pane) : '',
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
    now: from.now,
  }
}

/**
 * One envoy tick of the next-action message. The first tick of the role only writes the baseline. Later ticks
 * keep the burst and the draft marks, and submit a NEXT-ACTION prompt when one is due and the envoy is idle
 * and its prompt box holds no draft in use. The marks are written as sent before the submit; a rejected
 * submit puts them back, so the next tick tries again.
 */
export async function pushNextAction(io: Io, teamdir: string, input: NextActionInput): Promise<void> {
  const view = nextActionView(input)
  lastView = { key: view.key, snapshot: view.snapshot }
  const path = marksPath(teamdir)
  const read = await readJson<unknown>(io, path)
  if (!isStored(read)) {
    await writeJson(io, path, { key: view.key, snapshot: view.snapshot, pending: null, draft: null } satisfies Stored)
    return
  }
  const stored: Stored = { ...read, draft: read.draft ?? null }
  const draft = draftHeld(stored.draft, await io.draft())
  const due = nextActionDue(stored, view, input.now)
  const kept: Stored = { key: stored.key, snapshot: stored.snapshot, pending: due.pending, draft: draft.mark }
  if (!due.due || isBusy(input.now) || draft.held) {
    if (JSON.stringify(kept) !== JSON.stringify(stored)) await writeJson(io, path, kept)
    return
  }
  const text = nextActionPrompt(view.block, changeList(stored.snapshot, input))
  await writeJson(io, path, { key: view.key, snapshot: view.snapshot, pending: null, draft: draft.mark } satisfies Stored)
  // Not awaited: the submit settles whenever the session takes the prompt, and a tick must end before that.
  void io.submit(text).catch(() => writeJson(io, path, kept).catch(() => undefined))
}

/** A `queue` call showed the human's cards to the envoy: the state of the last tick counts as sent. */
export async function markShown(io: Io, teamdir: string): Promise<void> {
  if (lastView === null) return
  const read = await readJson<unknown>(io, marksPath(teamdir))
  if (!isStored(read)) return
  await writeJson(io, marksPath(teamdir), { ...read, key: lastView.key, snapshot: lastView.snapshot, pending: null })
}
