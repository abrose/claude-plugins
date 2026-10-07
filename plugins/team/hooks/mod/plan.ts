import type { TeamPlan, TeamPlanItem } from '../../types'

const ITEM = /^\s*[-*]\s+\[([xX> ])\]\s*(.*?)\s*$/
const SECTIONS = new Set(['DONE', 'RUNNING', 'NEXT'])
const BUCKET = { x: 'done', '>': 'running', ' ': 'next' } as const

/** Buckets items by their mark, not their heading: the orchestrator flips a
 *  mark in place and does not always move the line to the matching section. */
export function parsePlan(text: string): TeamPlan {
  const plan: TeamPlan = { title: '', done: [], running: [], next: [] }
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

/** Fits the plan into `rows` item lines; DONE gives up its oldest items first. */
export function fitPlan(plan: TeamPlan, rows: number): { plan: TeamPlan; hiddenDone: number } {
  const room = Math.max(rows - plan.running.length - plan.next.length, 0)
  const done = plan.done.slice(Math.max(plan.done.length - room, 0))
  return { plan: { ...plan, done }, hiddenDone: plan.done.length - done.length }
}
