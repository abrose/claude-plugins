import type { TeamAgentRow } from '../../types'
import type { DecisionEntry } from './decide'
import { gatherFacts, reportIsFresh } from './facts'
import type { AgentFacts } from './facts'
import { bySession, herdrClose, herdrDialog, herdrPanes } from './herdr'
import type { HerdrAgent, HerdrListing, HerdrPane } from './herdr'
import { idleTabs, layoutActions } from './layout'
import type { LayoutInput } from './layout'
import { releasedLine, releaseAgent, releaseDue, releaseFailedLine } from './release'
import { watchLines } from './watch'
import type { WatchMemory } from './watch'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { pickReports } from './reports'
import type { ReportFile } from './reports'

export type TeamRecord = {
  role: string
  topic: string
  brief: string
  pane: string
  session?: string
  cwd?: string
  brief_sent_session?: string
}

const NON_RECORD = new Set(['config.json', 'watch-state.json', 'tabs.json', 'layout-flags.json', 'delivered.json', 'toasted.json'])

export async function readRecords(io: Io, teamdir: string): Promise<Record<string, TeamRecord>> {
  const out: Record<string, TeamRecord> = {}
  for (const file of (await io.list(teamdir)).sort()) {
    if (!file.endsWith('.json') || NON_RECORD.has(file)) continue
    const rec = await readJson<TeamRecord>(io, `${teamdir}/${file}`)
    if (rec) out[file.slice(0, -'.json'.length)] = rec
  }
  return out
}

export async function reportFiles(io: Io, run: string, records: Record<string, TeamRecord>): Promise<ReportFile[]> {
  const files: ReportFile[] = []
  for (const [name, rec] of Object.entries(records)) {
    if (rec.role === 'orchestrator') continue
    const path = `${run}/reports/${name}-${rec.topic}.md`
    const at = await io.mtime(path)
    const text = at === null ? null : await io.readText(path)
    if (at !== null && text !== null) files.push({ name, mtimeMs: at, text })
  }
  return files
}

/**
 * REPORT lines new since the last tick. `delivered` holds the marks as read;
 * `commit` writes them once the lines are sent, with `extra` marks merged in.
 */
export async function newReportLines(io: Io, run: string, teamdir: string,
                                     records: Record<string, TeamRecord>,
): Promise<{
  lines: string[]
  delivered: Record<string, number>
  commit: (extra?: Record<string, number>) => Promise<void>
}> {
  const path = `${teamdir}/delivered.json`
  const picked = pickReports(await reportFiles(io, run, records), await readJson<Record<string, number>>(io, path))
  return {
    lines: picked.lines,
    delivered: picked.delivered,
    commit: (extra = {}) => writeJson(io, path, { ...picked.delivered, ...extra }),
  }
}

/** The ledger `decide` writes: one entry per decision under `<teamdir>/decisions/`. */
export async function readLedger(io: Io, teamdir: string): Promise<DecisionEntry[]> {
  const entries: DecisionEntry[] = []
  for (const name of await io.list(`${teamdir}/decisions`)) {
    if (!/^\d+\.json$/.test(name)) continue
    const entry = await readJson<DecisionEntry>(io, `${teamdir}/decisions/${name}`)
    if (entry) entries.push(entry)
  }
  return entries
}

const NO_REPORT_AFTER = 120

/** The input of the layout rules from the records and herdr's two listings; `myId` is this session's id. */
async function layoutInput(
  io: Io, teamdir: string, records: Record<string, TeamRecord>, agents: HerdrAgent[], panes: HerdrPane[],
  briefed: Map<string, boolean>, myId: string, exemptTabs: string[],
): Promise<LayoutInput> {
  const marked = new Set(await io.list(`${teamdir}/pending`))
  const pendingFile = (pane: string) => pane.replace(/[:/]/g, '_')
  return {
    panes,
    teamTabs: (await readJson<string[]>(io, `${teamdir}/tabs.json`)) ?? [],
    orchTabs: [agents.find(a => a.agent_session?.value === myId)?.tab_id, ...exemptTabs]
      .filter((t): t is string => !!t),
    namedPanes: new Set(Object.values(records).map(r => r.pane)),
    pending: new Set(panes.map(p => p.pane_id).filter(id => marked.has(pendingFile(id)))),
    briefed,
    prevFlags: (await readJson<string[]>(io, `${teamdir}/layout-flags.json`)) ?? [],
  }
}

/**
 * WATCH lines for this tick: blocked turns (with their dialog), missing
 * reports, layout flags, and herdr going down. Closes empty panes a record
 * names. Releases an agent that stayed idle with a fresh report for
 * RELEASE_AFTER_MIN, and adds one line for it. Remembers what it flagged in
 * watch-state.json and layout-flags.json. `openCards` names the agents with
 * a card still open.
 */
export async function watchTick(
  io: Io, run: string, teamdir: string, records: Record<string, TeamRecord>,
  listed: HerdrListing, now: number, myId: string, exemptTabs: string[], openCards: Set<string>,
): Promise<string[]> {
  const memPath = `${teamdir}/watch-state.json`
  const mem = (await readJson<WatchMemory>(io, memPath)) ?? { agents: {}, _flagged: {}, _idle_since: {} }
  if (!listed.ok) {
    // A timer must not run across a gap in what herdr shows: the agent may have worked in it.
    await writeJson(io, memPath, { ...mem, _release_since: {}, _release_tried: {}, herdr_down: true })
    return mem.herdr_down ? [] : [`WATCH herdr unreachable: ${listed.reason}`]
  }

  const sessions = bySession(listed.agents)
  const facts: AgentFacts[] = []
  for (const [name, rec] of Object.entries(records)) {
    if (rec.role === 'orchestrator') continue
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (agent) facts.push(await gatherFacts(io, run, name, rec, agent.agent_status, now, NO_REPORT_AFTER))
  }
  const result = watchLines(facts, { ...mem, herdr_down: false }, now, NO_REPORT_AFTER)
  const panes = await herdrPanes(io)
  const layout = panes
    ? await layoutInput(io, teamdir, records, listed.agents,
        panes, new Map(facts.filter(f => records[f.name]?.brief).map(f => [f.pane, f.hasFreshReport])), myId, exemptTabs)
    : null
  // Never the agent of this session. A release not yet tried is marked tried before its steps run, so an
  // overlapping tick, or a step that fails, cannot start it a second time.
  const due = layout && panes
    ? releaseDue({
        facts: facts.filter(f => records[f.name]?.session !== myId),
        since: result.mem._release_since ?? {},
        tried: result.mem._release_tried ?? {},
        paneTab: new Map(panes.map(p => [p.pane_id, p.tab_id])),
        teamTabs: layout.teamTabs,
        orchTabs: layout.orchTabs,
        openCards,
        now,
      })
    : []
  for (const name of due) result.mem._release_tried![name] = true
  await writeJson(io, memPath, result.mem)
  const out: string[] = []
  for (const line of result.lines) {
    const name = line.slice('WATCH '.length).split(':')[0] ?? ''
    const pane = records[name]?.pane
    const dialog = result.blocked.includes(name) && pane ? await herdrDialog(io, pane) : ''
    out.push(dialog ? `${line}: ${dialog}` : line)
  }

  if (layout) {
    const actions = layoutActions(layout)
    for (const pane of actions.closes) await herdrClose(io, pane)
    await writeJson(io, `${teamdir}/layout-flags.json`, actions.flags)
    out.push(...actions.fresh.map(f => `WATCH ${f}`))
  }
  for (const name of due) {
    const pane = facts.find(f => f.name === name)?.pane ?? ''
    const released = await releaseAgent(io, name, pane)
    out.push(released.ok ? releasedLine(name, pane) : releaseFailedLine(name, released.step, released.reason))
  }
  return out
}

/**
 * The rows of idle team tabs for the Team overview, with the pane statuses seen. Read-only: the envoy session
 * draws them. The orchestrator's mod releases an agent after RELEASE_AFTER_MIN only in a team tab (tabs.json),
 * the same tabs as these rows, and not in an exempt tab; this list adds the rule that every briefed agent in
 * the tab has reported.
 */
export async function idleTabRows(
  io: Io, run: string, teamdir: string, records: Record<string, TeamRecord>,
  listed: HerdrListing, myId: string, exemptTabs: string[],
): Promise<string[]> {
  if (!listed.ok) return []
  const panes = await herdrPanes(io)
  if (!panes) return []
  const sessions = bySession(listed.agents)
  const briefed = new Map<string, boolean>()
  for (const [name, rec] of Object.entries(records)) {
    if (rec.role === 'orchestrator' || !rec.brief) continue
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (agent) briefed.set(agent.pane_id, await reportIsFresh(io, run, name, rec))
  }
  return idleTabs(await layoutInput(io, teamdir, records, listed.agents, panes, briefed, myId, exemptTabs))
}

/** A pane id herdr moved is written back to the record, and into `records` for the rest of the tick. */
export async function syncPanes(
  io: Io, teamdir: string, records: Record<string, TeamRecord>, listed: HerdrListing,
): Promise<void> {
  if (!listed.ok) return
  const sessions = bySession(listed.agents)
  for (const [name, rec] of Object.entries(records)) {
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (!agent || agent.pane_id === rec.pane) continue
    rec.pane = agent.pane_id
    const path = `${teamdir}/${name}.json`
    const latest = await readJson<TeamRecord>(io, path)
    if (latest) await writeJson(io, path, { ...latest, pane: agent.pane_id })
  }
}

/** One row per record, read-only: the pane shown is the one herdr reports. */
export function agentRows(records: Record<string, TeamRecord>, listed: HerdrListing): TeamAgentRow[] {
  const sessions = listed.ok ? bySession(listed.agents) : new Map<string, HerdrAgent>()
  return Object.entries(records).map(([name, rec]) => {
    const agent = rec.session ? sessions.get(rec.session) : undefined
    return { name, state: agent ? agent.agent_status : listed.ok ? 'gone' : '?', pane: agent ? agent.pane_id : rec.pane }
  })
}
