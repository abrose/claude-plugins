import type { Io } from './io'

export type HerdrAgent = {
  pane_id: string
  tab_id?: string
  agent_status: string
  agent_session?: { value: string }
}
export type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }
export type HerdrListing = { ok: true; agents: HerdrAgent[] } | { ok: false; reason: string }

async function herdr(io: Io, args: string[]) {
  const bin = (await io.envGet('HERDR_BIN_PATH')) ?? 'herdr'
  return io.run([bin, ...args])
}

function failure(r: { exitCode: number; stdout: string; stderr: string }): string {
  return (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.exitCode}`
}

export async function herdrAgents(io: Io): Promise<HerdrListing> {
  const r = await herdr(io, ['agent', 'list'])
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

export async function herdrDialog(io: Io, pane: string): Promise<string> {
  const r = await herdr(io, ['agent', 'read', pane, '--source', 'detection', '--lines', '20'])
  return r.stdout.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
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

/**
 * Sends /clear to the agent in the pane; the failure reason, or '' when it worked. /clear never starts a
 * turn, so herdr always answers `agent_prompt_stalled`: that is the expected answer here, not a failure.
 */
export async function herdrClear(io: Io, pane: string): Promise<string> {
  const r = await herdr(io, ['agent', 'prompt', pane, '/clear', '--wait'])
  if (r.exitCode === 0 || `${r.stderr}${r.stdout}`.includes('agent_prompt_stalled')) return ''
  return failure(r)
}

export function bySession(list: HerdrAgent[]): Map<string, HerdrAgent> {
  const map = new Map<string, HerdrAgent>()
  for (const a of list) if (a.agent_session?.value) map.set(a.agent_session.value, a)
  return map
}
