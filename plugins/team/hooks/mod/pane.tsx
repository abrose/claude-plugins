import type { Elements } from 'claude-code'
import type { TeamAgentRow, TeamCard, TeamPlan, TeamPlanItem } from '../../types'
import { queueGroups } from './cards'
import type { QueueGroup } from './cards'
import { fitPlan } from './plan'

export const TEAM_PANE = 'team'
export const QUESTIONS_PANE = 'questions'
export const hiddenKey = (teamId: string) => `overviewHidden:${teamId}`
/** Only the person's own close hides the overview. A close by a plugin or on unload does not. */
export const closeHides = (origin: { kind: string }) => origin.kind === 'person'

export type PaneView = {
  agents: TeamAgentRow[]
  /** Rows of idle team tabs, with the pane statuses seen: "tab w4:t19 idle, consider release (w4:p3K done)". */
  idle: string[]
  plan: TeamPlan | null
  cards: TeamCard[]
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
  const groups = queueGroups(view.cards)
  const unresolved = groups.flatMap(g => g.cards)
  const urgent = unresolved.filter(c => c.urgent)
  const tally = (cards: TeamCard[], status: 'open' | 'assumed') => cards.filter(c => c.status === status).length
  const groupRow = (g: QueueGroup) =>
    [g.tag, ...(['open', 'assumed'] as const)
      .filter(s => tally(g.cards, s) > 0)
      .map(s => `${tally(g.cards, s)} ${s}`)].join('  ')
  const questionRows = (unresolved.length === 0 ? 1 : 1 + urgent.length + groups.length) + 1
  const room = Math.max(view.rows - view.agents.length - view.idle.length - 12 - questionRows, 3)
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
      {unresolved.length === 0 ? (
        <Text dimColor>Questions: none open</Text>
      ) : (
        <Box flexDirection="column">
          <Text bold>{`Questions (${tally(unresolved, 'open')} open, ${tally(unresolved, 'assumed')} assumed)`}</Text>
          {urgent.map(c => (
            <Text key={c.id} wrap="truncate-end">
              <Text color="yellow">!</Text> {c.id} {c.from}: {c.question}
            </Text>
          ))}
          {groups.map(g => <Text key={g.tag} wrap="truncate-end">{` ${groupRow(g)}`}</Text>)}
        </Box>
      )}
      <Text> </Text>
      <Text bold>Agents</Text>
      {view.agents.length === 0 && <Text dimColor> (none)</Text>}
      {view.agents.map((a, i) => (
        <Button key={a.name} plain hotkey={i < 9 ? String(i + 1) : undefined} onPress={() => focus(a)}>
          {`${a.state.padEnd(8)} ${a.name} ${a.pane}`}
        </Button>
      ))}
      {view.idle.map(row => <Text key={row} dimColor wrap="truncate-end">{row}</Text>)}
      {view.error !== '' && <Text color="red" wrap="truncate-end">{view.error}</Text>}
      <Text dimColor>tick {view.tickAt || '-'}</Text>
    </Box>
  )
}

/** The question log: every card, newest first, one row each with how it stands or closed. */
export function drawQuestions({ Box, Text }: Pick<Elements['terminal'], 'Box' | 'Text'>, cards: TeamCard[]) {
  const row = (c: TeamCard) =>
    `${c.id} ${c.status}${c.decision === undefined ? '' : ` #${c.decision}`} ${c.door} ${c.from}/${c.tag}: ${c.question}`
  return (
    <Box flexDirection="column">
      {cards.length === 0 && <Text dimColor>no questions yet</Text>}
      {[...cards].sort((a, b) => b.n - a.n).map(c => <Text key={c.id} wrap="truncate-end">{row(c)}</Text>)}
    </Box>
  )
}
