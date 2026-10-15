import type { Io } from './io'
import { teamDir } from './paths'

export const INBOX_LOG = 'inbox.log'
/** The log keeps about this many characters: the newest lines. */
const MAX_CHARS = 200_000

/** One log entry: the time, then the text. Every line after the first is indented by two spaces. */
export function inboxEntry(at: number, text: string): string {
  const [first = '', ...rest] = text.split(/\r\n|[\r\n\u{2028}\u{2029}]/u)
  return `${[`${new Date(at).toISOString()} ${first}`, ...rest.map(l => `  ${l}`)].join('\n')}\n`
}

/** Appends one received line to `.team/inbox.log`; the oldest lines go when the log grows past the cap. */
export async function logReceived(io: Io, text: string): Promise<void> {
  const path = `${await teamDir(io)}/${INBOX_LOG}`
  const all = ((await io.readText(path)) ?? '') + inboxEntry(await io.now(), text)
  if (all.length <= MAX_CHARS) return io.writeText(path, all)
  const cut = all.slice(-MAX_CHARS)
  return io.writeText(path, cut.slice(cut.indexOf('\n') + 1))
}
