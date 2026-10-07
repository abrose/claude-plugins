import type { SentPrompt } from '../../types'

export const isOwn = (origin: { kind: string }) => origin.kind === 'composer' || origin.kind === 'bridge'

/** The prompt's number and send time, or undefined for one sent before the mod loaded. */
export function findSent(list: SentPrompt[], text: string) {
  const i = list.map(one => one.text).lastIndexOf(text)
  const one = list[i]

  return one === undefined ? undefined : { n: i + 1, at: one.at, queued: one.queued === true }
}

export function clockTime(ms: number) {
  const d = new Date(ms)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
