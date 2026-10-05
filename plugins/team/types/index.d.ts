export type TeamAgentRow = { name: string; state: string; pane: string }
export type TeamPlanItem = { mark: 'x' | '>' | ' '; text: string }
export type TeamPlan = {
  title: string
  done: TeamPlanItem[]
  running: TeamPlanItem[]
  next: TeamPlanItem[]
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
