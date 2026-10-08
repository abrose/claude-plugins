import type { DecisionEntry } from './decide'

export function decisionLine(e: DecisionEntry): string {
  const cards = e.cards.map(c => `${c.id} ${c.from}/${c.tag}`).join(', ')
  const overrides = e.overrides.length > 0 ? ` - overrides assumption ${e.overrides.join(', ')}` : ''
  return `DECISION ${e.n} (${cards}): ${e.answer}${overrides}`
}

/** DECISION lines for entries above the mark, in number order. A missing mark is 0: the ledger holds only what `decide` wrote. */
export function pickDecisions(
  entries: DecisionEntry[], mark: number | undefined,
): { lines: string[]; mark: number } {
  const seen = mark ?? 0
  const fresh = entries.filter(e => e.n > seen).sort((a, b) => a.n - b.n)
  return { lines: fresh.map(decisionLine), mark: Math.max(seen, ...fresh.map(e => e.n)) }
}
