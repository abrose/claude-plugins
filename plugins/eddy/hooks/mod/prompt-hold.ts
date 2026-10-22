/**
 * The hold against a flicker: a card about a worker's permission prompt closes only after its prompt counted
 * as gone on `HOLD_TICKS` ticks in a row. Memory only, keyed by card id: a reload starts the count again,
 * which only delays a close by one tick. No state file, so none can read as an agent record.
 */
export const HOLD_TICKS = 2

type Hold = { ticks: number; since: number }

const holds = new Map<string, Hold>()

/**
 * One tick's verdict for a card: `gone` true adds one to its count, false (the prompt shows, or herdr could
 * not say) starts the count over. `due` is true when the count reached `HOLD_TICKS`.
 */
export function holdStep(id: string, gone: boolean, now: number): { due: boolean } {
  if (!gone) {
    holds.delete(id)
    return { due: false }
  }
  const held = holds.get(id) ?? { ticks: 0, since: now }
  const next = { ticks: held.ticks + 1, since: held.since }
  holds.set(id, next)
  return { due: next.ticks >= HOLD_TICKS }
}

/** Since when (ms) the card's prompt looks gone; undefined while the prompt shows or was not judged yet. */
export const goneSince = (id: string): number | undefined => holds.get(id)?.since

/** Drops the counts of every card not in `ids`: a card answered or closed no longer counts. */
export function keepHolds(ids: Set<string>): void {
  for (const id of [...holds.keys()]) if (!ids.has(id)) holds.delete(id)
}

export const clearHold = (id: string) => {
  holds.delete(id)
}

export const resetHolds = () => {
  holds.clear()
}
