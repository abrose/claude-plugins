import type { TeamAgentRow } from '../../types'
import { gatherFacts } from './facts'
import type { AgentFacts } from './facts'
import { bySession, herdrClose, herdrDialog, herdrPanes } from './herdr'
import type { HerdrAgent, HerdrListing } from './herdr'
import { layoutActions } from './layout'
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

const NON_RECORD = new Set(['config.json', 'watch-state.json', 'tabs.json', 'layout-flags.json', 'delivered.json'])

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
    const path = `${run}/reports/${name}-${rec.topic}.md`
    const at = await io.mtime(path)
    const text = at === null ? null : await io.readText(path)
    if (at !== null && text !== null) files.push({ name, mtimeMs: at, text })
  }
  return files
}

/** REPORT lines new since the last tick; `commit` writes the marks once they are sent. */
export async function newReportLines(io: Io, run: string, teamdir: string,
                                     records: Record<string, TeamRecord>,
): Promise<{ lines: string[]; commit: () => Promise<void> }> {
  const path = `${teamdir}/delivered.json`
  const picked = pickReports(await reportFiles(io, run, records), await readJson<Record<string, number>>(io, path))
  return { lines: picked.lines, commit: () => writeJson(io, path, picked.delivered) }
}

const NO_REPORT_AFTER = 120

/**
 * WATCH lines for this tick: blocked turns (with their dialog), missing
 * reports, layout flags, and herdr going down. Closes empty panes a record
 * names. Remembers what it flagged in watch-state.json and layout-flags.json.
 */
export async function watchTick(
  io: Io, run: string, teamdir: string, records: Record<string, TeamRecord>,
  listed: HerdrListing, now: number, myId: string,
): Promise<string[]> {
  const memPath = `${teamdir}/watch-state.json`
  const mem = (await readJson<WatchMemory>(io, memPath)) ?? { agents: {}, _flagged: {}, _idle_since: {} }
  if (!listed.ok) {
    await writeJson(io, memPath, { ...mem, herdr_down: true })
    return mem.herdr_down ? [] : [`WATCH herdr unreachable: ${listed.reason}`]
  }

  const sessions = bySession(listed.agents)
  const facts: AgentFacts[] = []
  for (const [name, rec] of Object.entries(records)) {
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (agent) facts.push(await gatherFacts(io, run, name, rec, agent.agent_status, now, NO_REPORT_AFTER))
  }
  const result = watchLines(facts, { ...mem, herdr_down: false }, now, NO_REPORT_AFTER)
  await writeJson(io, memPath, result.mem)
  const out: string[] = []
  for (const line of result.lines) {
    const name = line.slice('WATCH '.length).split(':')[0] ?? ''
    const pane = records[name]?.pane
    const dialog = result.blocked.includes(name) && pane ? await herdrDialog(io, pane) : ''
    out.push(dialog ? `${line}: ${dialog}` : line)
  }

  const panes = await herdrPanes(io)
  if (panes) {
    const flagsPath = `${teamdir}/layout-flags.json`
    const marked = new Set(await io.list(`${teamdir}/pending`))
    const pendingFile = (pane: string) => pane.replace(/[:/]/g, '_')
    const layout = layoutActions({
      panes,
      teamTabs: (await readJson<string[]>(io, `${teamdir}/tabs.json`)) ?? [],
      orchTab: listed.agents.find(a => a.agent_session?.value === myId)?.tab_id ?? null,
      namedPanes: new Set(Object.values(records).map(r => r.pane)),
      pending: new Set(panes.map(p => p.pane_id).filter(id => marked.has(pendingFile(id)))),
      briefed: new Map(facts.filter(f => records[f.name]?.brief).map(f => [f.pane, f.hasFreshReport])),
      prevFlags: (await readJson<string[]>(io, flagsPath)) ?? [],
    })
    for (const pane of layout.closes) await herdrClose(io, pane)
    await writeJson(io, flagsPath, layout.flags)
    out.push(...layout.fresh.map(f => `WATCH ${f}`))
  }
  return out
}

/** One row per record; a pane id herdr moved is written back to the record. */
export async function agentRows(
  io: Io, teamdir: string, records: Record<string, TeamRecord>, listed: HerdrListing,
): Promise<TeamAgentRow[]> {
  const sessions = listed.ok ? bySession(listed.agents) : new Map<string, HerdrAgent>()
  const rows: TeamAgentRow[] = []
  for (const [name, rec] of Object.entries(records)) {
    const agent = rec.session ? sessions.get(rec.session) : undefined
    if (agent && agent.pane_id !== rec.pane) {
      rec.pane = agent.pane_id
      const path = `${teamdir}/${name}.json`
      const latest = await readJson<TeamRecord>(io, path)
      if (latest) await writeJson(io, path, { ...latest, pane: agent.pane_id })
    }
    rows.push({ name, state: agent ? agent.agent_status : listed.ok ? 'gone' : '?', pane: rec.pane })
  }
  return rows
}
