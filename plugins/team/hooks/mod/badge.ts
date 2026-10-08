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
