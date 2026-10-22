import { sessionRole } from './activation'
import type { Io } from './io'
import { teamDir } from './paths'
import { readRecords } from './tick'

/** The tools the team mod registers in every session. In an eddy session they show up beside eddy's own. */
export const TEAM_TOOLS = ['ask', 'queue', 'decide', 'relay', 'brief_send', 'reset_self'] as const

/** The name the engine gives a team tool: `mcp__team__<name>`. */
export const teamToolName = (name: string) => `mcp__team__${name}`

/** Each team tool with its engine name: eddy.tsx registers one deny hook per entry. */
export const teamToolCalls = TEAM_TOOLS.map(name => ({ name, tool: teamToolName(name) }))

/**
 * True when this session belongs to an eddy run: it holds the orchestrator or the envoy role, or an agent record
 * of the run names its session (the same lookup as `asker` in questions.ts).
 */
export async function eddyActive(io: Io): Promise<boolean> {
  if (await sessionRole(io)) return true
  const session = await io.sessionId()
  const records = await readRecords(io, await teamDir(io))
  return Object.values(records).some(rec => rec.session === session)
}

export const denyText = (name: string) =>
  `This is an eddy session: use mcp__eddy__${name}. The team mod's tools work only in team runs.`
