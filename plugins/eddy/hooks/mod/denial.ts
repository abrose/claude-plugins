import { readJson, writeJson } from './io'
import type { Io } from './io'
import { runDir, teamDir } from './paths'
import { readRecords } from './tick'

/** The last auto-mode denial of one agent, in `<teamdir>/denials/<name>.json`. */
export type Denial = { tool: string; reason: string; at: number }

const REASON_CAP = 200

export const denialsDir = (teamdir: string) => `${teamdir}/denials`

/** The record name of this session's worker; null for the orchestrator and for a session with no record. */
async function workerName(io: Io, teamdir: string): Promise<string | null> {
  const session = await io.sessionId()
  for (const [name, rec] of Object.entries(await readRecords(io, teamdir))) {
    if (rec.role !== 'orchestrator' && rec.session === session) return name
  }
  return null
}

/**
 * Writes the denial mark of this worker. It never throws: the hook that calls it must pass the event on,
 * whatever happens here, because the mark is a signal and no part of the permission decision.
 */
export async function recordDenial(io: Io, tool: string, reason: string): Promise<void> {
  try {
    const teamdir = await teamDir(io)
    const name = await workerName(io, teamdir)
    if (name === null) return
    await io.run(['mkdir', '-p', denialsDir(teamdir)])
    const mark: Denial = { tool, reason: reason.slice(0, REASON_CAP), at: await io.now() }
    await writeJson(io, `${denialsDir(teamdir)}/${name}.json`, mark)
  } catch {
    // The mark is lost; the event goes on.
  }
}

/** Every denial mark, by agent name. */
export async function readDenials(io: Io, teamdir: string): Promise<(Denial & { name: string })[]> {
  const out: (Denial & { name: string })[] = []
  for (const file of (await io.list(denialsDir(teamdir))).sort()) {
    if (!file.endsWith('.json')) continue
    const mark = await readJson<Denial>(io, `${denialsDir(teamdir)}/${file}`)
    if (mark && typeof mark.at === 'number') out.push({ ...mark, name: file.slice(0, -'.json'.length) })
  }
  return out
}

/**
 * The denial of this agent that is newer than its brief, or null. A denial with no brief file counts.
 * Same freshness rule as a REPORT (`reportIsFresh`): older than the brief belongs to the last task.
 */
export async function freshDenial(io: Io, teamdir: string, name: string, topic: string): Promise<Denial | null> {
  const mark = await readJson<Denial>(io, `${denialsDir(teamdir)}/${name}.json`)
  if (!mark || typeof mark.at !== 'number') return null
  const briefAt = await io.mtime(`${await runDir(io)}/brief-${name}-${topic}.md`)
  return briefAt !== null && mark.at <= briefAt ? null : mark
}
