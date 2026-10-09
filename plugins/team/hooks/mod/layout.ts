import type { HerdrPane } from './herdr'

export type LayoutInput = {
  panes: HerdrPane[]
  teamTabs: string[]
  /** The exempt tabs (the envoy's, the human's workspace, and the orchestrator's): never closed or flagged. */
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

/** A pane a record names that holds no agent any more, and is not one team-start is still bringing up. */
const isEmpty = (input: LayoutInput) => (p: HerdrPane) =>
  !OCCUPIED.has(p.agent_status) && input.namedPanes.has(p.pane_id) && !input.pending.has(p.pane_id)

/** The panes of each team tab the layout rules look at: not an exempt tab, not a tab no team start made. */
function teamTabPanes(input: LayoutInput): Map<string, HerdrPane[]> {
  const byTab = new Map<string, HerdrPane[]>()
  for (const p of input.panes) byTab.set(p.tab_id, [...(byTab.get(p.tab_id) ?? []), p])
  for (const tab of [...byTab.keys()]) {
    if (!input.teamTabs.includes(tab) || input.orchTabs.includes(tab)) byTab.delete(tab)
  }
  return byTab
}

/** Empty panes to close and layout flags; `fresh` holds the flags not raised last time. */
export function layoutActions(input: LayoutInput): { closes: string[]; flags: string[]; fresh: string[] } {
  const closes: string[] = []
  const flags: string[] = []
  for (const [tab, list] of teamTabPanes(input)) {
    if (list.length > BUDGET) flags.push(`layout: tab ${tab} over budget (${list.length}/${BUDGET})`)
    closes.push(...list.filter(isEmpty(input)).map(p => p.pane_id))
  }
  const unique = [...new Set(flags)].sort()
  return { closes, flags: unique, fresh: unique.filter(f => !input.prevFlags.includes(f)) }
}

/**
 * The team tabs whose every pane is idle or done and whose briefed agents all reported: one row each, with
 * the pane statuses seen, for the Team overview. Not a prompt: the mod releases such an agent by itself
 * after RELEASE_AFTER_MIN, and a row that shows what it saw cannot mislead a reader who looks later.
 */
export function idleTabs(input: LayoutInput): string[] {
  const rows: string[] = []
  for (const [tab, list] of teamTabPanes(input)) {
    const occupied = list.filter(p => !isEmpty(input)(p))
    const briefedHere = occupied.filter(p => input.briefed.has(p.pane_id))
    if (occupied.length > 0
        && occupied.every(p => p.agent_status === 'idle' || p.agent_status === 'done')
        && briefedHere.length > 0
        && briefedHere.every(p => input.briefed.get(p.pane_id) === true)) {
      rows.push(`tab ${tab} idle, consider release (${occupied.map(p => `${p.pane_id} ${p.agent_status}`).join(', ')})`)
    }
  }
  return rows.sort()
}
