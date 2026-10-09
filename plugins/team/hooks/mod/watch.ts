import type { AgentFacts } from './facts'

export type WatchMemory = {
  agents: Record<string, string>
  _flagged: Record<string, boolean>
  _idle_since: Record<string, number>
  /** Since when each agent has been idle or done with a fresh report, without a break. The auto-release timer. */
  _release_since?: Record<string, number>
  /** Agents whose release was tried and stopped: not tried again until they work, block or lose their report. */
  _release_tried?: Record<string, boolean>
  herdr_down?: boolean
}

/** WATCH lines for state changes and missing reports; `after` is in seconds. */
export function watchLines(
  facts: AgentFacts[],
  mem: WatchMemory,
  now: number,
  after: number,
): { blocked: string[]; lines: string[]; mem: WatchMemory } {
  const next: WatchMemory = {
    agents: {}, _flagged: {}, _idle_since: {}, _release_since: {}, _release_tried: {}, herdr_down: mem.herdr_down,
  }
  const blocked: string[] = []
  const lines: string[] = []
  for (const f of facts) {
    next.agents[f.name] = f.state
    if ((f.state === 'idle' || f.state === 'done') && f.hasFreshReport) {
      next._release_since![f.name] = mem._release_since?.[f.name] ?? now
      if (mem._release_tried?.[f.name]) next._release_tried![f.name] = true
    }
    const old = mem.agents[f.name]
    if (old !== undefined && old !== f.state && f.state === 'blocked') {
      blocked.push(f.name)
      lines.push(`WATCH ${f.name}: ${old} -> blocked`)
    }
    if (f.state === 'blocked' || f.hasFreshReport) continue
    const idle = f.state === 'idle' || f.state === 'done'
    if (idle) next._idle_since[f.name] = mem._idle_since[f.name] ?? now
    const since = next._idle_since[f.name]
    const idleLong = idle && since !== undefined && now - since >= after * 1000
    if (idleLong || f.quietSinceStop) {
      if (!mem._flagged[f.name]) lines.push(`WATCH ${f.name}: idle, no report - read ${f.reportPath}`)
      next._flagged[f.name] = true
    }
  }
  return { blocked, lines, mem: next }
}
