import { activeConfig } from './activation'
import type { Io, ToolResult } from './io'
import { runDir } from './paths'

/** The nudge goes out at this share of the auto-compact threshold (a token count), when auto-compact is on. */
export const AUTOCOMPACT_SHARE = 0.7
/** The nudge goes out at this share of the context window when no auto-compact threshold exists. */
export const WINDOW_SHARE = 0.6
/** A handover file older than the request by more than this is stale: the orchestrator must write it again. */
export const HANDOVER_MAX_AGE_MS = 10 * 60 * 1000

export const HANDOVER_FILE = 'orch-handover.md'
export const RESET_TOOL = 'reset_self'
export const RESET_TOOL_SPEC = {
  name: RESET_TOOL,
  description:
    'Ask the team mod to compact your context at the next idle moment. Call it only at a safe point, ' +
    `after you wrote scratchpad/current/${HANDOVER_FILE}. It refuses when that file is missing or stale.`,
  inputSchema: { type: 'object', properties: {} },
}

/**
 * Where the open cards are, in words the orchestrator can act on. The `queue` tool refuses in the orchestrator
 * session, so the text names the files. `ask` writes `<run dir>/.team/questions/Q-<n>.json` (hooks/mod/questions.ts)
 * and `status` is `open`, or `assumed` for a parked card (`queueGroups` in hooks/mod/cards.ts lists both).
 */
const OPEN_CARDS =
  'the open cards (the files scratchpad/current/.team/questions/Q-*.json whose status is open or assumed)'

/**
 * What the summary of an orchestrator compact must keep, and what the orchestrator reads afterwards.
 * `hooks/handlers/session-start.sh` carries the same text for the SessionStart pointer: change both.
 */
export const COMPACT_INSTRUCTIONS =
  'You are the team orchestrator. Keep the ticket of this run, the agents in flight (name, pane, session, topic, brief) ' +
  'and the open cards. After the compact: reload the team-orchestration skill, read the decisions file, then ' +
  `scratchpad/current/${HANDOVER_FILE}, the plan file and scratchpad/current/orchestration-decisions.md, then the reports ` +
  `newer than ${HANDOVER_FILE}, then ${OPEN_CARDS}.`

/**
 * The line the mod sends after its own compact resolved. No turn starts after an idle-time compact, so this
 * line starts one: the orchestrator reloads at once instead of at some later line.
 */
export const RESUME_LINE =
  'RESUME after compact: reload the team-orchestration skill, read the decisions file, ' +
  `scratchpad/current/${HANDOVER_FILE}, the plan file, scratchpad/current/orchestration-decisions.md, ` +
  `the reports newer than the handover and ${OPEN_CARDS}, then continue from the handover`

/** The WATCH line the mod sends once per crossing of the nudge limit. */
export const nudgeLine = (percent: number) =>
  `WATCH context ${percent} percent: reach a safe point, write scratchpad/current/${HANDOVER_FILE}, then call ${RESET_TOOL}`

/** The context figures of `$.session.usage({ breakdown })` that the nudge reads. */
export type ContextFigures = {
  /** Input tokens of the last response; absent until the first response of the live window. */
  tokens?: number
  /** The model's context window (`context.window`). */
  window: number
  /**
   * The window `/context` and the auto-compact measure against (`breakdown.rawMaxTokens`): the model's limit or a
   * smaller compaction window. Absent without a breakdown.
   */
  compactWindow?: number
  /** The token count at which auto-compact runs; absent when it is off. */
  autoCompactThreshold?: number
}

/** The two engine calls the reset needs. The mod test mock answers neither, so the logic reaches them through this port. */
export type ResetPort = {
  figures: () => Promise<ContextFigures>
  /** Resolves `{}` when the conversation was compacted, `{ skip }` when a hook vetoed it; rejects while a turn runs. */
  compact: (instructions: string) => Promise<{ skip?: string }>
}

/** The token count at which the nudge goes out. */
export function nudgeLimit(f: ContextFigures): number {
  if (f.autoCompactThreshold !== undefined && f.autoCompactThreshold > 0) return f.autoCompactThreshold * AUTOCOMPACT_SHARE
  return f.window * WINDOW_SHARE
}

/**
 * The context fill in percent, null while no response has measured it. The figure is `tokens` over the compact
 * window, which is the window `/context` shows. The model window is the fallback when no breakdown gave one:
 * `context.percent` is not used, it is measured against the model window and read 23 where `/context` read 67.
 */
export function contextPercent(f: ContextFigures): number | null {
  const window = f.compactWindow !== undefined && f.compactWindow > 0 ? f.compactWindow : f.window
  if (f.tokens === undefined || window <= 0) return null
  return Math.round((f.tokens / window) * 100)
}

/**
 * One nudge decision. `armed` is true until a nudge went out; it becomes true again when the context falls
 * below the limit, or when a compact lands (`onCompacted`). An unmeasured context changes nothing.
 */
export function nudgeStep(armed: boolean, f: ContextFigures): { send: boolean; armed: boolean } {
  if (f.tokens === undefined) return { send: false, armed }
  if (f.tokens >= nudgeLimit(f)) return { send: armed, armed: false }
  return { send: false, armed: true }
}

export type Gate = {
  pending: boolean
  turnRunning: boolean
  retryLines: number
  sendsInFlight: number
  compacting: boolean
}

/** True when a requested compact may run now: no turn, no unsent line, no send in flight, no compact under way. */
export const canCompact = (g: Gate): boolean =>
  g.pending && !g.turnRunning && g.retryLines === 0 && g.sendsInFlight === 0 && !g.compacting

/** The instructions of a compact with the handover text added after any already present. */
export function withHandoverInstructions(existing?: string): string {
  const own = existing?.trim() ?? ''
  if (own === '') return COMPACT_INSTRUCTIONS
  if (own.includes(COMPACT_INSTRUCTIONS)) return own
  return `${own}\n\n${COMPACT_INSTRUCTIONS}`
}

/** Why a handover file does not count, or null when it does. `mtime` is null for a missing file. */
export function handoverVerdict(mtime: number | null, now: number): string | null {
  if (mtime === null) return `${HANDOVER_FILE} does not exist: write it, then call ${RESET_TOOL} again`
  if (mtime < now - HANDOVER_MAX_AGE_MS) {
    return `${HANDOVER_FILE} is older than 10 minutes: write it again, then call ${RESET_TOOL}`
  }
  return null
}

// Module memory only: a mod restart loses it. A new session.start resets it; a /clear keeps it.
let armed = true
let requestedAt: number | null = null
let turnRunning = false
let compacting = false

export const requestReset = (at: number) => {
  requestedAt = at
}
export const noteMainTurn = (running: boolean) => {
  turnRunning = running
}
/** A compact landed, whoever ran it: the request is met and the nudge may go out again. */
export const onCompacted = () => {
  requestedAt = null
  armed = true
}
export const clearResetState = () => {
  armed = true
  requestedAt = null
  turnRunning = false
  compacting = false
}

/** The nudge line to send now, or none. Reads the context through the port; a failed read sends nothing. */
export async function nudgeLines(port: ResetPort): Promise<string[]> {
  if (requestedAt !== null) return []
  let figures: ContextFigures
  try {
    figures = await port.figures()
  } catch {
    return []
  }
  const step = nudgeStep(armed, figures)
  armed = step.armed
  return step.send ? [nudgeLine(contextPercent(figures) ?? 0)] : []
}

/**
 * Starts the requested compact when the session is idle. Returns false when the gate was closed and nothing
 * ran, true once a call was made (and has settled). A rejected or skipped call keeps the request and tells
 * `report` why, so the next tick tries again. A resolved call calls `resume` once, after the compact flag is
 * down: it must start the turn that does the reload (no turn follows an idle-time compact by itself).
 * `resume` does not wait for the send, so a long submit never holds the next compact back.
 */
export async function compactWhenIdle(
  port: ResetPort, busy: { retryLines: number; sendsInFlight: number }, report: (text: string) => Promise<void>,
  resume: () => void,
): Promise<boolean> {
  if (!canCompact({ pending: requestedAt !== null, turnRunning, compacting, ...busy })) return false
  compacting = true
  let resolved = false
  try {
    const done = await port.compact(COMPACT_INSTRUCTIONS)
    if (done.skip !== undefined) await report(`compact skipped: ${done.skip.slice(0, 160)}`)
    else {
      onCompacted()
      resolved = true
    }
  } catch (err) {
    await report(`compact refused: ${String(err).slice(0, 160)}`)
  } finally {
    compacting = false
  }
  if (resolved) resume()
  return true
}

/** The `reset_self` tool: records the request. A tool call runs in a turn, and a compact cannot, so the tick compacts. */
export async function resetSelf(io: Io): Promise<ToolResult> {
  if (!(await activeConfig(io))) return { result: `${RESET_TOOL} works only in the orchestrator session`, isError: true }
  const now = await io.now()
  const refusal = handoverVerdict(await io.mtime(`${await runDir(io)}/${HANDOVER_FILE}`), now)
  if (refusal !== null) return { result: refusal, isError: true }
  requestReset(now)
  return { result: 'compact requested: the mod compacts at the next idle moment; stop your turn now' }
}
