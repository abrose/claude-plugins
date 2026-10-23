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
  /** Set when the eddy mod closed the card by itself (its prompt was gone). A human or envoy close leaves it out. */
  closed_by?: 'eddy mod'
  /**
   * Set with `closed_by` when the card closed because a different prompt shows in the same pane: the dialog of
   * that new prompt. A card closed by a state signal (the agent left the prompt, was released) leaves it out.
   */
  next_dialog?: string
  /** Set by `ask` when the card is about a worker's permission prompt (`prompt_of`). */
  prompt?: TeamCardPrompt
  at: number
}

export type EddyBranchMode = 'fold' | 'pane'
export type EddyBranchRow = { role: 'human' | 'assistant'; text: string; at: number }
/** A discussion of one card outside the trunk. `<run>/.eddy/branches/B-<n>.json` is its one store, whatever its mode. */
export type EddyBranch = {
  /** B-<n> */
  id: string
  n: number
  /** Q-<m> */
  card: string
  seed: Pick<TeamCard, 'context' | 'question' | 'options' | 'recommendation' | 'refs' | 'blocks' | 'door' | 'rework'>
  mode: EddyBranchMode
  /** The session that may write the branch: the envoy (fold) or the discussant (pane). */
  owner: string
  /** The envoy session id at open. */
  envoy: string
  state: 'open' | 'settled' | 'dropped'
  /** The marker of the current fold stretch. */
  mark: string
  /** First 60 chars of the human prompt that opened the branch (the native fold pick point). */
  opened_by: string
  /** History rows kept from earlier homes; the current home adds rows after them. */
  base: number
  history: EddyBranchRow[]
  note: { leaning: string; own_options: string[]; open_points: string[] }
  /** Discussants started for this branch. */
  agents: { name: string; pane: string; session: string }[]
  settle?: { answer: string; summary: string; at: number; filled_at?: number }
  summary?: string
  decision?: number
  log: { from: EddyBranchMode | 'none'; to: EddyBranchMode; at: number }[]
  opened_at: number
  closed_at?: number
}
/** One reason that holds news back. T4 adds { by: 'branch' }; a later delivery mode adds its own. */
export type EddyNewsHold = { by: string; card?: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    eddy: {
      active: boolean
      agents: TeamAgentRow[]
      idleTabs: string[]
      plan: TeamPlan | null
      cards: TeamCard[]
      /** Ids of the question cards shown expanded in the Eddy questions tab. */
      expandedCards: string[]
      urgent: number
      planPath: string
      tickAt: string
      /** The plugin version read from plugin.json at session start; '' when unknown. */
      version: string
      error: string
      /** The open card branch, or null. */
      branch: { id: string; card: string; mode: EddyBranchMode } | null
      /** The holds in force, and how many news items wait behind them. */
      holds: { list: EddyNewsHold[]; waiting: number }
    }
  }
}
