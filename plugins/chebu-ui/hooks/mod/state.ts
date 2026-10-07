import type { SentPrompt } from '../../types'

/** The id of the pane that lists the session's prompts. */
export const PROMPT_PANE = 'prompt-log'

export const isOwn = (origin: { kind: string }) => origin.kind === 'composer' || origin.kind === 'bridge'

/** The prompt's number and send time, or undefined for one sent before the mod loaded. */
export function findSent(list: SentPrompt[], text: string) {
  const i = list.map(one => one.text).lastIndexOf(text)
  const one = list[i]

  return one === undefined ? undefined : { n: i + 1, at: one.at, queued: one.queued === true }
}

/**
 * A prompt's text as it is drawn: without the `<pasted_content id="…">` tags the host wraps
 * around a paste. The tags stay in the sent text, which is what a prompt is matched by.
 */
export function shownText(text: string) {
  return text.replace(/[ \t]*<\/?pasted_content(?:\s+[\w-]+="[^"]*")*\s*>[ \t]*(?:\r?\n)?/g, '').trimEnd()
}

export function clockTime(ms: number) {
  const d = new Date(ms)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
