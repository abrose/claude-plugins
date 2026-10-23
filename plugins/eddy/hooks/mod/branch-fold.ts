import type { EddyBranch, EddyBranchRow } from '../../types'
import { openBranch, writeBranch } from './branches'
import type { BranchHome } from './branches'
import type { Io, TranscriptRow } from './io'
import { NEXT_ACTION_PREFIX } from './next-action'
import { teamDir } from './paths'

/** The text a fold branch opens with: the marker first, so the transcript holds it (a tool result keeps the text). */
export const foldOpenText = (rec: EddyBranch) =>
  `${rec.mark}\nThe branch is open here. News waits until you close it.`

const holdsMark = (row: TranscriptRow, mark: string) =>
  row.text.includes(mark)
  || (row.toolUses ?? []).some(u => u.text?.includes(mark))
  || (row.toolResults ?? []).some(r => r.text?.includes(mark))

/** Does the transcript still hold the marker of the branch? An unreadable transcript (read as empty) does not. */
export async function foldMarkerSeen(rec: EddyBranch, io: Io): Promise<boolean> {
  return (await io.messages()).some(row => holdsMark(row, rec.mark))
}

/**
 * The rows of a fold branch: what was said after the newest row that holds `mark` (in its text, a tool use or a
 * tool result). Only text counts: a row without text (a bare tool result) and a NEXT-ACTION row (urgent news is
 * no branch talk) are left out. A transcript without the marker gives no rows, never the whole trunk.
 * The transcript has no time stamp per row; every row takes `at`.
 */
export function rowsAfterMark(messages: readonly TranscriptRow[], mark: string, at: number): EddyBranchRow[] {
  let from = -1
  messages.forEach((row, i) => {
    if (holdsMark(row, mark)) from = i
  })
  if (from < 0) return []
  return messages.slice(from + 1)
    .filter(row => row.text.trim() !== '' && !row.text.startsWith(NEXT_ACTION_PREFIX))
    .map(row => ({ role: row.role === 'user' ? 'human' as const : 'assistant' as const, text: row.text, at }))
}

/**
 * The fold home: the branch lives in the envoy chat. `busy` and `leave` never refuse, because the caller is the
 * envoy's own turn. `collect` is the rows kept from earlier homes plus the rows after the marker. `enter` is T7's.
 */
export const foldHome: BranchHome = {
  busy: async () => null,
  collect: async (rec, io) => [...rec.history.slice(0, rec.base), ...rowsAfterMark(await io.messages(), rec.mark, await io.now())],
  enter: async rec => ({ owner: rec.envoy, text: foldOpenText(rec) }),
  leave: async () => null,
}

/**
 * What the human does to fold the branch into one summary: Claude Code's own rewind, "Summarize from here". The
 * pick point is the human's opening prompt, because rewind lists the prompts the human sent; the marker sits in a
 * tool result, which rewind does not list.
 */
export function foldCloseHint(rec: EddyBranch): string {
  const pick = rec.opened_by === '' ? 'the message that opened the branch' : `"${rec.opened_by}"`
  return `Fold the branch now: on an empty prompt press Esc twice, pick your message ${pick}, ` +
    'choose Summarize from here, and type: keep the decision and the summary.'
}

const AFTER_COMPACT = / \(after compact \d+\)$/

/**
 * An auto compact is about to replace the transcript while a fold branch is open: keep the rows said so far in
 * the record (`history`, `base`) and give the branch a fresh marker, because the old one goes with the transcript.
 * The fresh marker still starts with the branch marker. Answers the way back: it puts the record as it was, for a
 * compact that another hook vetoes (the transcript then stays whole, with the old marker in it). Answers null when
 * no fold branch is open.
 */
export async function snapshotOnAutoCompact(
  io: Io, messages: readonly TranscriptRow[],
): Promise<(() => Promise<void>) | null> {
  const teamdir = await teamDir(io)
  const before = await openBranch(io, teamdir)
  if (!before || before.mode !== 'fold') return null
  const now = await io.now()
  const history = [...before.history.slice(0, before.base), ...rowsAfterMark(messages, before.mark, now)]
  await writeBranch(io, teamdir, {
    ...before, history, base: history.length, mark: `${before.mark.replace(AFTER_COMPACT, '')} (after compact ${now})`,
  })
  return () => writeBranch(io, teamdir, before)
}
