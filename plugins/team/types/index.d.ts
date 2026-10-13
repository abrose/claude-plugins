export type TeamAgentRow = { name: string; state: string; pane: string }
export type TeamPlanItem = { mark: 'x' | '>' | ' ' | '?'; text: string }
export type TeamPlan = {
  title: string
  /** Items marked `[?]`: they wait on the human. */
  waits: TeamPlanItem[]
  done: TeamPlanItem[]
  running: TeamPlanItem[]
  next: TeamPlanItem[]
}

export type TeamCardOption = { option: string; cost: string }
/** The permission prompt a card is about: the worker, its session and pane, and the dialog text at filing. */
export type TeamCardPrompt = {
  agent: string
  /** The worker's role at filing: it names the worker in a reason after its record is gone. */
  role: string
  session: string
  pane: string
  /** '' when the agent showed no prompt or the read failed at filing. */
  dialog: string
  at: number
}
export type TeamCard = {
  id: string
  n: number
  from: string
  tag: string
  context: string
  question: string
  options: TeamCardOption[]
  recommendation: string
  blocks: string
  door: 'one-way' | 'two-way'
  rework: string
  urgent: boolean
  refs: string[]
  status: 'open' | 'assumed' | 'answered' | 'obsolete'
  decision?: number
  reason?: string
  /** Set when the team mod closed the card by itself (its prompt was gone). A human or envoy close leaves it out. */
  closed_by?: 'team mod'
  /**
   * Set with `closed_by` when the card closed because a different prompt shows in the same pane: the dialog of
   * that new prompt. A card closed by a state signal (the agent left the prompt, was released) leaves it out.
   */
  next_dialog?: string
  /** Set by `ask` when the card is about a worker's permission prompt (`prompt_of`). */
  prompt?: TeamCardPrompt
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    team: {
      active: boolean
      agents: TeamAgentRow[]
      idleTabs: string[]
      plan: TeamPlan | null
      cards: TeamCard[]
      /** Ids of the question cards shown expanded in the Questions tab. */
      expandedCards: string[]
      urgent: number
      planPath: string
      tickAt: string
      /** The plugin version read from plugin.json at session start; '' when unknown. */
      version: string
      error: string
    }
  }
}
