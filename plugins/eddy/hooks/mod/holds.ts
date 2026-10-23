import type { EddyNewsHold, TeamCard } from '../../types'
import { openBranch } from './branches'
import { samePrompt } from './herdr'
import type { Io } from './io'
import { triggersOf } from './next-action'
import type { NextActionSnapshot } from './next-action'
import { teamDir } from './paths'

/** One source of holds: it answers the holds it has in force now, [] when none. */
export type HoldSource = (io: Io) => Promise<EddyNewsHold[]>

/** An open card branch holds the news until it closes (decision 26: no time limit in the spike). */
const branchHold: HoldSource = async io => {
  const rec = await openBranch(io, await teamDir(io))
  return rec ? [{ by: 'branch', card: rec.card, label: `branch open on ${rec.card} (${rec.id}, ${rec.mode})` }] : []
}

// A later delivery mode adds its source here and nowhere else.
const sources: HoldSource[] = [branchHold]

/** Every hold in force now, in source order. */
export async function newsHolds(io: Io): Promise<EddyNewsHold[]> {
  const found: EddyNewsHold[] = []
  for (const source of sources) found.push(...(await source(io)))
  return found
}

/**
 * The news that may pass while a hold is in force (decision 26). Three kinds pass, nothing else:
 * - a permission prompt: a worker shows a new prompt (trigger T5), or a new card is linked to a prompt that no
 *   message announced yet (`prompt` on the card);
 * - a one-way-door card (`door: 'one-way'`);
 * - a card that blocks every running agent. The card has no field for that (`blocks` is free text), so the
 *   stand-in is today's urgent-card rule (`urgent`), for this kind only.
 * The other urgent triggers of `triggersOf` (a denial T6, the orchestrator gone T7) wait with the rest.
 * Stand-in for the third kind (open question 1 of the T4 notes): `urgent` stands for "blocks every running agent";
 * decision 26 stays literal, so T6 and T7 wait (open question 2).
 * Answers the snapshot after only the passing news (`before` moved on by those changes alone), or null when
 * nothing passes. A message built on it tells the passing news; the rest stays a change against it and goes out
 * in the one message after the last hold lifts.
 */
export function passedNews(before: NextActionSnapshot, now: NextActionSnapshot, cards: TeamCard[]): NextActionSnapshot | null {
  const prompt = triggersOf(before, now).fired.includes('T5')
  const announced = (id: string) => {
    const link = now.linked.find(l => l.id === id)
    return !!link && before.blocked.some(b => b.name === link.agent && samePrompt(b.dialog, link.dialog))
  }
  const cardIds = cards
    .filter(c => c.status === 'open' && !before.open.includes(c.id) && !announced(c.id))
    .filter(c => c.prompt !== undefined || c.door === 'one-way' || c.urgent)
    .map(c => c.id)
  if (!prompt && cardIds.length === 0) return null
  const open = [...before.open, ...cardIds]
  return {
    ...before,
    open,
    urgent: now.urgent.filter(id => open.includes(id)),
    linked: now.linked.filter(l => open.includes(l.id)),
    blocked: prompt ? now.blocked : before.blocked,
  }
}
