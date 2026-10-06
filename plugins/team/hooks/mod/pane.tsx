import type { Elements } from 'claude-code'
import type { TeamAgentRow, TeamPlan, TeamPlanItem } from '../../types'
import { fitPlan } from './plan'

export const PANE = 'team-overview'
export const hiddenKey = (teamId: string) => `overviewHidden:${teamId}`

export type PaneView = {
  agents: TeamAgentRow[]
  plan: TeamPlan | null
  planPath: string
  tickAt: string
  error: string
  rows: number
}

const MARK = {
  x: { glyph: '✓', color: 'green', dim: true },
  '>': { glyph: '▶', color: 'yellow', dim: false },
  ' ': { glyph: '○', color: undefined, dim: false },
} as const

export function drawPane({ Box, Text, Button }: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>, view: PaneView,
  focus: (agent: TeamAgentRow) => void,
) {
  const room = Math.max(view.rows - view.agents.length - 12, 3)
  const fitted = view.plan ? fitPlan(view.plan, room) : null
  const item = (i: TeamPlanItem) => (
    <Text wrap="truncate-end" dimColor={MARK[i.mark].dim}>
      {' '}
      <Text color={MARK[i.mark].color}>{MARK[i.mark].glyph}</Text> {i.text}
    </Text>
  )
  const section = (title: string, items: TeamPlanItem[]) => (
    <Box flexDirection="column">
      <Text dimColor>{title}</Text>
      {items.length === 0 ? <Text dimColor> -</Text> : items.map(item)}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {fitted ? (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">{fitted.plan.title || 'Plan'}</Text>
          {section(fitted.hiddenDone ? `DONE (+${fitted.hiddenDone} earlier)` : 'DONE', fitted.plan.done)}
          {section('RUNNING', fitted.plan.running)}
          {section('NEXT', fitted.plan.next)}
        </Box>
      ) : (
        <Text dimColor wrap="truncate-end">no plan yet: {view.planPath}</Text>
      )}
      <Text> </Text>
      <Text bold>Agents</Text>
      {view.agents.length === 0 && <Text dimColor> (none)</Text>}
      {view.agents.map((a, i) => (
        <Button key={a.name} plain hotkey={i < 9 ? String(i + 1) : undefined} onPress={() => focus(a)}>
          {`${a.state.padEnd(8)} ${a.name} ${a.pane}`}
        </Button>
      ))}
      {view.error !== '' && <Text color="red" wrap="truncate-end">{view.error}</Text>}
      <Text dimColor>tick {view.tickAt || '-'}</Text>
    </Box>
  )
}
