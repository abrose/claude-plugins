import type { TeamAgentRow, TeamCard } from '../../types'
import { closeStalePrompt } from './decide'
import { herdrDialog, samePrompt } from './herdr'
import type { HerdrListing } from './herdr'
import type { Io } from './io'
import { clearHold, holdStep, keepHolds } from './prompt-hold'
import type { TeamRecord } from './tick'

type Link = NonNullable<TeamCard['prompt']>

/** What one tick saw of a card's agent. `dialog` is the dialog read now, '' when the agent is not blocked. */
export type PromptSeen = {
  /** herdr's listing answered. When false nothing else says anything. */
  listed: boolean
  record: TeamRecord | undefined
  row: TeamAgentRow | undefined
  dialog: string
}

export type PromptVerdict =
  | { kind: 'shows' }
  | { kind: 'unknown' }
  /**
   * `text` is the plain reason: it goes into the card's `reason` and into the WATCH line. `next` is the new
   * dialog, set only when the agent stays blocked on a different prompt: the orchestrator needs it to file a
   * card for that prompt, because no blocked WATCH line follows for a worker that never left `blocked`.
   */
  | { kind: 'gone'; text: string; next?: string }

/**
 * Whether the permission prompt a card is about still shows (design 2.2). In this order: herdr did not answer
 * (unknown); the record is gone (released); the record has a new session; herdr no longer lists the pane;
 * herdr cannot classify the agent (unknown, like a failed listing: the prompt may still show); the agent is
 * not blocked any more; the dialog differs from the one stored at filing. A dialog empty on either side
 * never counts as different: an empty fingerprint only ever closes by a state signal.
 */
export function promptVerdict(link: Link, seen: PromptSeen): PromptVerdict {
  if (!seen.listed) return { kind: 'unknown' }
  const role = seen.record?.role ?? link.role
  const pane = seen.row?.pane ?? seen.record?.pane ?? link.pane
  const gone = (why: string): PromptVerdict => ({
    kind: 'gone', text: `the permission prompt in the ${role}'s pane (${pane}) is gone: ${why}`,
  })
  if (!seen.record) return gone('the agent was released')
  if ((seen.record.session ?? '') !== link.session) return gone('the agent started a new session')
  const state = seen.row?.state ?? 'gone'
  if (state === 'gone') return gone('the pane is gone')
  if (state === 'unknown') return { kind: 'unknown' }
  if (state !== 'blocked') return gone(`the agent is now ${state}`)
  if (samePrompt(link.dialog, seen.dialog)) return { kind: 'shows' }
  return { ...gone('a different prompt shows there'), next: seen.dialog }
}

/**
 * The envoy half's step for the cards about a worker's permission prompt: one verdict per open or assumed
 * linked card, the hold count, and the close when the prompt was gone on two ticks in a row. Returns the
 * cards as they are after the close, and the dialogs it read (pane to text) so the next-action input does
 * not read them again. A failed close (a write error) is retried on the next tick, never thrown.
 */
export async function closeStalePromptCards(io: Io, input: {
  cards: TeamCard[]
  records: Record<string, TeamRecord>
  rows: TeamAgentRow[]
  listed: HerdrListing
  now: number
}): Promise<{ cards: TeamCard[]; dialogs: Map<string, string> }> {
  const dialogs = new Map<string, string>()
  const linked = input.cards.filter(c => c.prompt && (c.status === 'open' || c.status === 'assumed'))
  keepHolds(new Set(linked.map(c => c.id)))
  const closed = new Map<string, TeamCard>()
  for (const card of linked) {
    const link = card.prompt!
    const row = input.rows.find(r => r.name === link.agent)
    let dialog = ''
    if (input.listed.ok && row?.state === 'blocked') {
      dialog = dialogs.get(row.pane) ?? (await herdrDialog(io, row.pane))
      dialogs.set(row.pane, dialog)
    }
    const verdict = promptVerdict(link, { listed: input.listed.ok, record: input.records[link.agent], row, dialog })
    const { due } = holdStep(card.id, verdict.kind === 'gone', input.now)
    if (verdict.kind !== 'gone' || !due) continue
    try {
      const done = await closeStalePrompt(io, card.id, link, verdict.text, verdict.next)
      clearHold(card.id)
      if (done) closed.set(card.id, done)
    } catch {
      // The write failed: the count stays at the threshold, so the next tick tries again.
    }
  }
  return { cards: input.cards.map(c => closed.get(c.id) ?? c), dialogs }
}
