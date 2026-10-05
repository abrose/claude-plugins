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

export async function herdrAgents(io: Io): Promise<HerdrListing> {
  const r = await herdr(io, ['agent', 'list'])
  if (r.exitCode !== 0) return { ok: false, reason: (r.stderr || r.stdout).trim().slice(0, 200) || `exit ${r.exitCode}` }
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

export async function herdrClose(io: Io, pane: string): Promise<void> {
  await herdr(io, ['pane', 'close', pane])
}

export function bySession(list: HerdrAgent[]): Map<string, HerdrAgent> {
  const map = new Map<string, HerdrAgent>()
  for (const a of list) if (a.agent_session?.value) map.set(a.agent_session.value, a)
  return map
}
