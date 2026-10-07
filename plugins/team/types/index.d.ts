export type TeamAgentRow = { name: string; state: string; pane: string }
export type TeamPlanItem = { mark: 'x' | '>' | ' '; text: string }
export type TeamPlan = {
  title: string
  done: TeamPlanItem[]
  running: TeamPlanItem[]
  next: TeamPlanItem[]
}

export type TeamCardOption = { option: string; cost: string }
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
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    team: {
      active: boolean
      agents: TeamAgentRow[]
      plan: TeamPlan | null
      planPath: string
      tickAt: string
      error: string
    }
  }
}
