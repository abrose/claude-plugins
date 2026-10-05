import type { TeamPlan, TeamPlanItem } from '../../types'

const ITEM = /^\s*[-*]\s+\[([xX> ])\]\s*(.*?)\s*$/
const SECTIONS = { DONE: 'done', RUNNING: 'running', NEXT: 'next' } as const

export function parsePlan(text: string): TeamPlan {
  const plan: TeamPlan = { title: '', done: [], running: [], next: [] }
  let section: TeamPlanItem[] | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('# ') && !plan.title) {
      plan.title = line.slice(2).trim()
    } else if (line.startsWith('## ')) {
      const key = SECTIONS[line.slice(3).trim().toUpperCase() as keyof typeof SECTIONS]
      section = key ? plan[key] : null
    } else {
      const m = ITEM.exec(line)
      if (m && section) section.push({ mark: (m[1] ?? ' ').toLowerCase() as TeamPlanItem['mark'], text: m[2] ?? '' })
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
