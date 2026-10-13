import type { Io } from './io'

export type HerdrAgent = {
  pane_id: string
  tab_id?: string
  agent_status: string
  agent_session?: { value: string }
  /** The herdr name `herdr agent start <name>` gave it; herdr does not restore it after a restart. */
  name?: string
}
export type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }
export type HerdrListing = { ok: true; agents: HerdrAgent[] } | { ok: false; reason: string }

async function herdr(io: Io, args: string[], timeoutMs?: number) {
  const bin = (await io.envGet('HERDR_BIN_PATH')) ?? 'herdr'
  return io.run([bin, ...args], timeoutMs)
}

function failure(r: { exitCode: number; stdout: string; stderr: string }): string {
  return (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.exitCode}`
}

/** `timeoutMs` bounds the call; without it the `io.run` default (10 s) applies. */
export async function herdrAgents(io: Io, timeoutMs?: number): Promise<HerdrListing> {
  const r = await herdr(io, ['agent', 'list'], timeoutMs)
  if (r.exitCode !== 0) return { ok: false, reason: failure(r) }
  try {
    return { ok: true, agents: JSON.parse(r.stdout)?.result?.agents ?? [] }
  } catch {
    return { ok: false, reason: 'bad output from herdr agent list' }
  }
}

export async function herdrPanes(io: Io): Promise<HerdrPane[] | null> {
  const r = await herdr(io, ['pane', 'list'])
  if (r.exitCode !== 0) return null
  try {
    return JSON.parse(r.stdout)?.result?.panes ?? []
  } catch {
    return null
  }
}

const DIALOG_CAP = 200
const nonEmpty = (rows: string[]) => rows.map(l => l.trim()).filter(l => l !== '')
const isFrameRule = (row: string) => row.length >= 20 && /^─+$/.test(row)
const isDashedRule = (row: string) => /^╌+$/.test(row)

/**
 * The text of the dialog in a `herdr agent read` snapshot (the bottom 20 screen rows, old history on top).
 * A permission dialog sits below the last full-width `─` rule and replaces the input box and footer:
 * - title row / command row (between the two `╌` rules) / last row ending with `?`, or
 * - when the frame has no `╌` pair or no `?` row: every row below the frame, minus `╌` rules and a
 *   last `Esc to cancel` row.
 * With no frame rule the last 3 non-empty rows are returned. The result is capped at 200 characters.
 */
export function dialogText(snapshot: string): string {
  const rows = snapshot.split('\n').map(l => l.trim())
  const frame = rows.map(isFrameRule).lastIndexOf(true)
  if (frame === -1) return nonEmpty(rows).slice(-3).join(' / ').slice(0, DIALOG_CAP)
  const below = nonEmpty(rows.slice(frame + 1))
  const dashed = below.flatMap((row, i) => (isDashedRule(row) ? [i] : []))
  const question = below.findLastIndex(row => row.endsWith('?'))
  if (dashed.length >= 2 && question !== -1) {
    const command = below.slice(dashed[0] + 1, dashed[1])[0] ?? ''
    return [below[0], command, below[question]].join(' / ').slice(0, DIALOG_CAP)
  }
  const kept = below.filter(row => !isDashedRule(row))
  if (kept.at(-1)?.startsWith('Esc to cancel')) kept.pop()
  return kept.join(' / ').slice(0, DIALOG_CAP)
}

/** A dialog text with its whitespace collapsed and trimmed: what two reads of one prompt agree on. */
export const normalizeDialog = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Whether two dialog texts are the same prompt: equal after whitespace is collapsed. A dialog empty on either
 * side (a failed read, an agent that showed no prompt at filing) never counts as a different prompt.
 */
export function samePrompt(a: string, b: string): boolean {
  const left = normalizeDialog(a)
  const right = normalizeDialog(b)
  return left === '' || right === '' || left === right
}

/** The dialog a blocked agent shows, for the WATCH line. Empty when the snapshot is empty or the call fails. */
export async function herdrDialog(io: Io, pane: string, timeoutMs?: number): Promise<string> {
  const r = await herdr(io, ['agent', 'read', pane, '--source', 'detection', '--lines', '20'], timeoutMs)
  return r.exitCode === 0 ? dialogText(r.stdout) : ''
}

/** Focuses the agent's pane; the failure reason, or '' when it worked. */
export async function herdrFocus(io: Io, pane: string): Promise<string> {
  const r = await herdr(io, ['agent', 'focus', pane])
  return r.exitCode === 0 ? '' : failure(r)
}

/** Closes the pane; the failure reason, or '' when it worked. */
export async function herdrClose(io: Io, pane: string): Promise<string> {
  const r = await herdr(io, ['pane', 'close', pane])
  return r.exitCode === 0 ? '' : failure(r)
}

export function bySession(list: HerdrAgent[]): Map<string, HerdrAgent> {
  const map = new Map<string, HerdrAgent>()
  for (const a of list) if (a.agent_session?.value) map.set(a.agent_session.value, a)
  return map
}
