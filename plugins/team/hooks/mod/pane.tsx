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
  teamId: string
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
              <Text color="yellow">!</Text> {c.id} {shortFrom(c.from, view.teamId)}: {c.question}
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

/** Flip to true if the unicode glyphs draw at the wrong width in a terminal. */
export const ASCII_GLYPHS = false

/** The one place for card glyphs: status and door, each with an ASCII fallback behind ASCII_GLYPHS. */
const CARD_GLYPH = {
  status: {
    open: { glyph: '●', ascii: '?', color: 'yellow', dim: false },
    assumed: { glyph: '◐', ascii: '~', color: 'cyan', dim: false },
    answered: { glyph: '✓', ascii: '+', color: 'green', dim: true },
    obsolete: { glyph: '✗', ascii: 'x', color: undefined, dim: true },
  },
  door: {
    'one-way': { glyph: '→', ascii: '1' },
    'two-way': { glyph: '⇄', ascii: '2' },
  },
  expand: {
    collapsed: { glyph: '▸', ascii: '>' },
    open: { glyph: '▾', ascii: 'v' },
  },
} as const

/** The expanded ids that still name a card. Returns the same array when none goes, so the caller can skip a write. */
export function pruneExpanded(expanded: string[], cards: Pick<TeamCard, 'id'>[]): string[] {
  const live = expanded.filter(id => cards.some(c => c.id === id))
  return live.length === expanded.length ? expanded : live
}

/** The sender as a person reads it: no `<team_id>-` prefix, no `/general` tag. */
export function shortFrom(from: string, teamId: string): string {
  const prefix = `${teamId}-`
  return teamId !== '' && from.startsWith(prefix) ? from.slice(prefix.length) : from
}

export function cardSource(c: Pick<TeamCard, 'from' | 'tag'>, teamId: string): string {
  const from = shortFrom(c.from, teamId)
  return c.tag === 'general' ? from : `${from}/${c.tag}`
}

export type QuestionsView = {
  cards: TeamCard[]
  teamId: string
  /** Ids of the cards shown expanded. */
  expanded: string[]
  toggle: (id: string) => void
  /** Draw ASCII glyphs. Defaults to ASCII_GLYPHS. */
  ascii?: boolean
  /** Cells across the pane body (`bodyColumns`). The headline is cut to fit; absent means no cut. */
  columns?: number
}

/** The marker, a space and the status glyph that open a headline: each glyph is one column (live check, 40 columns). */
const HEAD_COLUMNS = 3

/** Cut `text` to `room` columns with an ellipsis at the cut. A Text inside a Button does not truncate by itself. */
export function cutTail(text: string, room: number | undefined): string {
  if (room === undefined) return text
  const chars = Array.from(text)
  return chars.length <= room ? text : `${chars.slice(0, Math.max(room - 1, 0)).join('')}…`
}

/** The question log: every card newest first, one collapsible row each. Enter or a click expands the full card. */
export function drawQuestions({ Box, Text, Button }: Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>,
  { cards, teamId, expanded, toggle, ascii = ASCII_GLYPHS, columns }: QuestionsView,
) {
  const status = (c: TeamCard) => CARD_GLYPH.status[c.status]
  const glyph = (g: { glyph: string; ascii: string }) => (ascii ? g.ascii : g.glyph)
  const headline = (c: TeamCard, open: boolean) => (
    <Text wrap="truncate-end" dimColor={status(c).dim}>
      {glyph(CARD_GLYPH.expand[open ? 'open' : 'collapsed'])} <Text color={status(c).color}>{glyph(status(c))}</Text>
      {cutTail(
        ` ${c.id}${c.decision === undefined ? '' : ` #${c.decision}`} ${glyph(CARD_GLYPH.door[c.door])} `
          + `${cardSource(c, teamId)}: ${c.question}`,
        columns === undefined ? undefined : columns - HEAD_COLUMNS,
      )}
    </Text>
  )
  const lines = (c: TeamCard) => [
    c.question,
    `Context: ${c.context}`,
    ...c.options.map((o, i) => `${i + 1}. ${o.option} (${o.cost})`),
    `Rec: ${c.recommendation}`,
    `Blocks: ${c.blocks}`,
    `Rework: ${c.rework}   Door: ${c.door}`,
    ...(c.reason === undefined ? [] : [`Reason: ${c.reason}`]),
  ]
  return (
    <Box flexDirection="column">
      {cards.length === 0 && <Text dimColor>no questions yet</Text>}
      {[...cards].sort((a, b) => b.n - a.n).flatMap(c => {
        const open = expanded.includes(c.id)
        return [
          <Button key={c.id} plain onPress={() => toggle(c.id)}>{headline(c, open)}</Button>,
          ...(open ? [(
            <Box key={`${c.id}:body`} flexDirection="column" paddingLeft={4}>
              {lines(c).map((l, i) => <Text key={i}>{l}</Text>)}
            </Box>
          )] : []),
        ]
      })}
    </Box>
  )
}
