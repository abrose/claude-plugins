import { readJson, tailText } from './io'
import type { Io } from './io'
import { reportLine } from './reports'
import type { TeamRecord } from './tick'

export type AgentFacts = {
  name: string
  state: string
  pane: string
  reportPath: string
  hasFreshReport: boolean
  quietSinceStop: boolean
}

function lastTurnAt(tail: string): number | null {
  let last: number | null = null
  for (const line of tail.split('\n')) {
    try {
      const ev = JSON.parse(line)
      if ((ev.type === 'user' || ev.type === 'assistant') && ev.timestamp) last = Date.parse(ev.timestamp)
    } catch {
      continue
    }
  }
  return last
}

/**
 * What the watch rules need about one agent. A report counts as fresh when it
 * holds a REPORT line and is not older than the agent's brief. A stop counts
 * as quiet when it is `after` seconds old, newer than the brief, and no turn
 * started since.
 */
export async function gatherFacts(
  io: Io, run: string, name: string, rec: TeamRecord, state: string, now: number, after: number,
): Promise<AgentFacts> {
  const reportPath = `${run}/reports/${name}-${rec.topic}.md`
  const briefAt = await io.mtime(`${run}/brief-${name}-${rec.topic}.md`)
  const reportAt = await io.mtime(reportPath)
  const text = reportAt === null ? null : await io.readText(reportPath)
  const hasFreshReport = reportAt !== null && text !== null && reportLine(text) !== null
    && !(briefAt !== null && reportAt < briefAt)

  let quietSinceStop = false
  const stop = await readJson<{ transcript: string; at: number }>(io, `${run}/.team/stops/${name}.json`)
  if (stop && now - stop.at * 1000 >= after * 1000 && !(briefAt !== null && briefAt > stop.at * 1000)) {
    const last = lastTurnAt(await tailText(io, stop.transcript, 262144))
    quietSinceStop = last === null || last <= stop.at * 1000
  }
  return { name, state, pane: rec.pane, reportPath, hasFreshReport, quietSinceStop }
}
