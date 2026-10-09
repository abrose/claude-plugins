import type { AgentFacts } from './facts'
import { herdrClear, herdrClose } from './herdr'
import type { Io } from './io'

/** How long an agent must stay idle or done, with a fresh report, before the mod releases it. */
export const RELEASE_AFTER_MIN = 30

export type ReleaseCheck = {
  facts: AgentFacts[]
  /** Since when each agent has been idle or done with a fresh report (the timer in watch-state.json). */
  since: Record<string, number>
  /** Agents whose release was tried and stopped. */
  tried: Record<string, boolean>
  paneTab: Map<string, string>
  /** The team tabs (tabs.json): the tabs a team start made. Only a pane in one of them is released. */
  teamTabs: string[]
  /** The exempt tabs: the orchestrator's, the envoy's and the human's. */
  orchTabs: string[]
  /** Names of the agents with an open or assumed card. */
  openCards: Set<string>
  now: number
}

/**
 * The agents to release now. The timer holds the rest of the rule: it runs only while the agent is idle or
 * done with a fresh REPORT, and `working` or `blocked` resets it. This adds the limit and the guards.
 */
export function releaseDue(c: ReleaseCheck): string[] {
  return c.facts
    .filter(f => {
      const since = c.since[f.name]
      const tab = c.paneTab.get(f.pane)
      return since !== undefined && c.now - since >= RELEASE_AFTER_MIN * 60_000
        && !c.tried[f.name]
        && !c.openCards.has(f.name)
        && tab !== undefined && c.teamTabs.includes(tab) && !c.orchTabs.includes(tab)
    })
    .map(f => f.name)
}

export type ReleaseResult = { ok: true } | { ok: false; step: string; reason: string }

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 160) || 'no reason given'

/**
 * The steps of `/team:release <name>`, once each, in order: /clear, close the pane, then `team-forget` (it
 * deletes the session index entry and then the record). The first step that fails stops the release.
 */
export async function releaseAgent(io: Io, name: string, pane: string): Promise<ReleaseResult> {
  const cleared = await herdrClear(io, pane)
  if (cleared !== '') return { ok: false, step: 'clear', reason: oneLine(cleared) }
  const closed = await herdrClose(io, pane)
  if (closed !== '') return { ok: false, step: 'close pane', reason: oneLine(closed) }
  const forgot = await io.run([`${io.pluginRoot}/bin/team-forget`, name])
  if (forgot.exitCode !== 0) {
    return { ok: false, step: 'team-forget', reason: oneLine(forgot.stderr || forgot.stdout || `exit ${forgot.exitCode}`) }
  }
  return { ok: true }
}

export const releasedLine = (name: string, pane: string) =>
  `released ${name} (${pane}) after ${RELEASE_AFTER_MIN} min idle`

export const releaseFailedLine = (name: string, step: string, reason: string) =>
  `WATCH ${name}: auto-release failed at ${step}: ${reason}`
