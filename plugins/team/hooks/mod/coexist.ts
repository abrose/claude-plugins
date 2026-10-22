import { sessionRole } from './activation'
import type { Io } from './io'
import { teamDir } from './paths'
import { readRecords } from './tick'

/** The prefix the engine gives every eddy tool. Eddy registers its tools in every session it loads in. */
export const EDDY_PREFIX = 'mcp__eddy__'

/** The tools the team mod also has. Any other eddy tool has no team equivalent. */
const SHARED_TOOLS = ['ask', 'queue', 'decide', 'relay', 'brief_send', 'reset_self']

/**
 * True when this session belongs to a team run: it holds the orchestrator or the envoy role, or an agent record
 * of the run names its session (the same lookup as `asker` in questions.ts).
 */
export async function teamActive(io: Io): Promise<boolean> {
  if (await sessionRole(io)) return true
  const session = await io.sessionId()
  const records = await readRecords(io, await teamDir(io))
  return Object.values(records).some(rec => rec.session === session)
}

/** The bare name of an eddy tool, or null for any other tool. */
export const eddyToolName = (tool: string) => (tool.startsWith(EDDY_PREFIX) ? tool.slice(EDDY_PREFIX.length) : null)

export const denyText = (name: string) =>
  SHARED_TOOLS.includes(name)
    ? `This is a team session: use mcp__team__${name}. The eddy mod's tools work only in eddy runs.`
    : `This is a team session: the eddy tool ${name} has no team equivalent. The eddy mod's tools work only in eddy runs.`
