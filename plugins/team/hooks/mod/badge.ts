import type { TeamCard } from '../../types'

const unresolvedUrgent = (cards: TeamCard[]) =>
  cards.filter(c => c.urgent && (c.status === 'open' || c.status === 'assumed')).sort((a, b) => a.n - b.n)

/** The status line text: how many urgent cards wait, and the oldest of them. Undefined when none wait. */
export function badgeText(cards: TeamCard[]): string | undefined {
  const waiting = unresolvedUrgent(cards)
  const oldest = waiting[0]
  return oldest ? `${waiting.length} urgent: ${oldest.id} ${oldest.from}: ${oldest.question}` : undefined
}

export const toastText = (c: TeamCard) => `URGENT ${c.id} ${c.from}: ${c.question}`

/**
 * The urgent cards to toast, and the marks to keep. `seen` is null when no marks
 * exist yet: that run is a baseline, so it marks every urgent card and toasts none.
 */
export function freshUrgent(cards: TeamCard[], seen: string[] | null): { toast: TeamCard[]; seen: string[] } {
  const urgent = cards.filter(c => c.urgent).sort((a, b) => a.n - b.n)
  const marks = new Set(seen ?? [])
  const toast = seen === null ? [] : unresolvedUrgent(cards).filter(c => !marks.has(c.id))
  for (const c of urgent) marks.add(c.id)
  return { toast, seen: [...marks] }
}

/** How long the whole team must wait on the human before the run counts as stalled: 8 ticks of 15 s. */
export const STALL_AFTER_MS = 120_000

/** How long an urgent-card toast and a stall toast stay on screen: 30 s (decision 7). */
export const TOAST_MS = 30_000

export type StallWorker = {
  /** The herdr state, or `gone` when herdr lists no agent for the record. */
  state: string
  /** Whether the worker's report is fresh; read only for an idle or done worker. */
  fresh: boolean
}

export type StallInput = {
  cards: TeamCard[]
  herdrUp: boolean
  workers: StallWorker[]
  /** The orchestrator's herdr state; undefined when herdr does not list it. */
  orchestrator: string | undefined
}

const quiet = (state: string | undefined) => state === 'idle' || state === 'done'

/**
 * The ids of the open cards when the whole team waits on the human, else null: herdr is up, no worker
 * works, every idle or done worker has a fresh report, the orchestrator is idle or done, and at least
 * one card is open. A parked (assumed) card does not count: the team goes on without it.
 */
export function stallIds(input: StallInput): string[] | null {
  const open = input.cards.filter(c => c.status === 'open').sort((a, b) => a.n - b.n)
  if (open.length === 0 || !input.herdrUp || !quiet(input.orchestrator)) return null
  const stuck = input.workers.every(w => w.state === 'gone' || (quiet(w.state) && w.fresh))
  return stuck ? open.map(c => c.id) : null
}

/**
 * The one status line has three claimants, in this order: a `prompt not sent` error (`notSent`, the line
 * as it shows now when it is one), the urgent badge, the stall text.
 */
export const pickStatus = (notSent: string | undefined, urgent: string | undefined, stall: string | undefined) =>
  notSent ?? urgent ?? stall

export const stallText = (ids: string[]) => `run waits on you: ${ids.length} open (${ids.join(', ')})`

// Two marks in toasted.json beside the urgent card ids: the episode under way and its toast.
const SINCE_MARK = 'stall:'
const TOAST_MARK = 'stall-toast:'

/**
 * The stall line and toast for this tick, and the marks to keep. `ids` is `stallIds` (null on a break),
 * `open` tells whether any card is open, `seen` is the marks as read. The timer is the
 * `stall:<ms>:<ids>` mark: it starts when the wait first holds for a set of open cards, starts over
 * when the set changes, and goes at once on a break. The toast is keyed by the same set: a new card or
 * an answer starts a new episode. A break keeps the toast mark, so the same cards that stall again after
 * an agent worked do not toast twice; it goes when the set changes or no card is open.
 */
export function freshStall(ids: string[] | null, open: boolean, seen: string[], now: number):
  { text: string | undefined; toast: string | undefined; seen: string[] } {
  const others = seen.filter(m => !m.startsWith(SINCE_MARK) && !m.startsWith(TOAST_MARK))
  if (ids === null) {
    const kept = seen.filter(m => !m.startsWith(SINCE_MARK) && (open || !m.startsWith(TOAST_MARK)))
    return { text: undefined, toast: undefined, seen: kept }
  }
  const key = ids.join(',')
  const held = seen.find(m => m.startsWith(SINCE_MARK))?.slice(SINCE_MARK.length)
  const colon = held?.indexOf(':') ?? -1
  const sameSet = held !== undefined && held.slice(colon + 1) === key
  const since = sameSet ? Number(held!.slice(0, colon)) : now
  const marks = [...others, `${SINCE_MARK}${since}:${key}`]
  const toasted = seen.includes(`${TOAST_MARK}${key}`)
  if (toasted) marks.push(`${TOAST_MARK}${key}`)
  if (now - since < STALL_AFTER_MS) return { text: undefined, toast: undefined, seen: marks }
  const text = stallText(ids)
  if (!toasted) marks.push(`${TOAST_MARK}${key}`)
  return { text, toast: toasted ? undefined : text, seen: marks }
}
