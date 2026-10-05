import { bySession, herdrAgents } from './herdr'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { teamDir } from './paths'
import type { TeamRecord } from './tick'

export const BRIEF_TOOL = 'brief_send'
export const BRIEF_TOOL_SPEC = {
  name: BRIEF_TOOL,
  description:
    'Send a composed brief to a team agent by its session id. Run `team-brief compose` first. ' +
    'Returns "<name>: <state>"; an error names the reason.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' }, topic: { type: 'string' } },
    required: ['name', 'topic'],
  },
}
// A hook gets 10 s and a clock wait counts against it; leave room for the send.
const WAIT_MS = 6000
const POLL_MS = 500

export type BriefResult = { result: string; isError?: true }
const fail = (result: string): BriefResult => ({ result, isError: true })

const briefedInThisSession = (rec: TeamRecord) =>
  rec.session !== undefined && rec.brief_sent_session === rec.session

/** The record once its session differs from the one last briefed, or after WAIT_MS. */
async function clearedRecord(io: Io, path: string): Promise<TeamRecord | null> {
  for (let waited = 0; ; waited += POLL_MS) {
    const rec = await readJson<TeamRecord>(io, path)
    if (!rec || !briefedInThisSession(rec) || waited >= WAIT_MS) return rec
    await io.sleep(POLL_MS)
  }
}

export async function briefSend(io: Io, name: string, topic: string): Promise<BriefResult> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return fail(`bad name: ${name}`)
  const path = `${await teamDir(io)}/${name}.json`
  const rec = await clearedRecord(io, path)
  if (!rec) return fail(`no agent record: ${name}`)
  if (!rec.session) return fail(`${name} has no session id; start it again with team-start`)
  if (briefedInThisSession(rec)) return fail(`${name} was not cleared since its last brief`)

  const prepared = await io.run([`${io.pluginRoot}/bin/team-brief`, 'prepare', name, '--topic', topic])
  if (prepared.exitCode !== 0) return fail(prepared.stderr.trim() || `team-brief prepare failed (${prepared.exitCode})`)
  const sent = await io.sendTo(rec.session, prepared.stdout.trim())
  if (!sent.isDelivered) return fail(`not delivered: ${sent.reason ?? 'unknown reason'}`)

  const latest = (await readJson<TeamRecord>(io, path)) ?? rec
  await writeJson(io, path, { ...latest, brief_sent_session: rec.session })
  const listed = await herdrAgents(io)
  const state = listed.ok ? bySession(listed.agents).get(rec.session)?.agent_status ?? 'gone' : 'unknown'
  return { result: `${name}: ${state}` }
}
