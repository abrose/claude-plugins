import type { TeamPlan, TeamPlanItem } from '../../types'

const ITEM = /^\s*[-*]\s+\[([xX>? ])\]\s*(.*?)\s*$/
const SECTIONS = new Set(['WAITS ON YOU', 'DONE', 'RUNNING', 'NEXT'])
const BUCKET = { x: 'done', '>': 'running', ' ': 'next', '?': 'waits' } as const

/** Buckets items by their mark, not their heading: the orchestrator flips a
 *  mark in place and does not always move the line to the matching section. */
export function parsePlan(text: string): TeamPlan {
  const plan: TeamPlan = { title: '', waits: [], done: [], running: [], next: [] }
  let inPlan = false
  for (const line of text.split('\n')) {
    if (line.startsWith('# ') && !plan.title) {
      plan.title = line.slice(2).trim()
    } else if (line.startsWith('## ')) {
      inPlan = SECTIONS.has(line.slice(3).trim().toUpperCase())
    } else {
      const m = ITEM.exec(line)
      if (!m || !inPlan) continue
      const mark = (m[1] ?? ' ').toLowerCase() as TeamPlanItem['mark']
      plan[BUCKET[mark]].push({ mark, text: m[2] ?? '' })
    }
  }
  return plan
}

/** The most DONE items the pane ever shows, however tall it is. */
export const DONE_CAP = 10

/** Fits the plan into `rows` item lines. DONE keeps at most its newest `DONE_CAP`
 *  items, fewer when the leftover rows are short; it gives up its oldest items first.
 *  WAITS, RUNNING and NEXT are never cut. */
export function fitPlan(plan: TeamPlan, rows: number): { plan: TeamPlan; hiddenDone: number } {
  const left = Math.max(rows - plan.waits.length - plan.running.length - plan.next.length, 0)
  const room = Math.min(DONE_CAP, left)
  const done = plan.done.slice(Math.max(plan.done.length - room, 0))
  return { plan: { ...plan, done }, hiddenDone: plan.done.length - done.length }
}
