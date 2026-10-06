import type { HerdrPane } from './herdr'

export type LayoutInput = {
  panes: HerdrPane[]
  teamTabs: string[]
  /** The orchestrator's tabs: the human's workspace, never closed or flagged. */
  orchTabs: string[]
  namedPanes: Set<string>
  /** Pane ids team-start marked while it brings an agent up: never closed. */
  pending: Set<string>
  /** Pane of each briefed agent, and whether it has a fresh report. */
  briefed: Map<string, boolean>
  prevFlags: string[]
}

const OCCUPIED = new Set(['idle', 'working', 'blocked', 'done'])
const BUDGET = 6

/** Empty panes to close and layout flags; `fresh` holds the flags not raised last time. */
export function layoutActions(input: LayoutInput): { closes: string[]; flags: string[]; fresh: string[] } {
  const byTab = new Map<string, HerdrPane[]>()
  for (const p of input.panes) byTab.set(p.tab_id, [...(byTab.get(p.tab_id) ?? []), p])
  const closes: string[] = []
  const flags: string[] = []
  for (const [tab, list] of byTab) {
    if (!input.teamTabs.includes(tab) || input.orchTabs.includes(tab)) continue
    if (list.length > BUDGET) flags.push(`layout: tab ${tab} over budget (${list.length}/${BUDGET})`)
    const empty = (p: HerdrPane) =>
      !OCCUPIED.has(p.agent_status) && input.namedPanes.has(p.pane_id) && !input.pending.has(p.pane_id)
    closes.push(...list.filter(empty).map(p => p.pane_id))
    const occupied = list.filter(p => !empty(p))
    const briefedHere = occupied.filter(p => input.briefed.has(p.pane_id))
    if (occupied.length > 0
        && occupied.every(p => p.agent_status === 'idle' || p.agent_status === 'done')
        && briefedHere.length > 0
        && briefedHere.every(p => input.briefed.get(p.pane_id) === true)) {
      flags.push(`layout: tab ${tab} idle, consider release`)
    }
  }
  const unique = [...new Set(flags)].sort()
  return { closes, flags: unique, fresh: unique.filter(f => !input.prevFlags.includes(f)) }
}
