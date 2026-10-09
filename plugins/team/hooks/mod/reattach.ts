import { readConfig } from './activation'
import type { TeamConfig } from './activation'
import { bySession, herdrAgents } from './herdr'
import type { HerdrAgent } from './herdr'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { teamDir } from './paths'
import { readRecords } from './tick'

// team-start waits up to 90 s for the agent plus up to 90 s for a busy pane. A `$` call does not count
// against the hook's 10 s budget, so the command waits for the script; ten minutes is the engine's cap.
const START_TIMEOUT_MS = 300_000
/**
 * team-orch-start's exit code when another start holds the start lock, or when it finds a live
 * orchestrator after it takes the lock. Its stale-lock age is twice START_TIMEOUT_MS, so a start this
 * command gave up on is not taken over at once (test_the_stale_age_is_twice_the_mod_start_timeout).
 */
const STARTING = 5

/**
 * The live herdr agent of the run's orchestrator. Right after an orchestrator /clear the config can
 * still name the old session id, so an agent that carries the orchestrator's herdr name (`cfg.orchestrator`,
 * set by `team-start` through `herdr agent start <name>`) or sits in the pane of the orchestrator record
 * (`<orchestrator>.json`'s `pane`) counts as alive too. herdr can reuse a pane id, so an agent in that
 * pane does not count when it is this session or the session of another team record.
 * team-orch-start applies the same rule after it takes the start lock.
 */
async function liveOrchestrator(io: Io, cfg: TeamConfig, agents: HerdrAgent[]): Promise<HerdrAgent | undefined> {
  const bySid = cfg.orchestrator_session ? bySession(agents).get(cfg.orchestrator_session) : undefined
  if (bySid) return bySid
  const byName = agents.find(a => a.name === cfg.orchestrator)
  if (byName) return byName
  const records = await readRecords(io, await teamDir(io))
  const pane = records[cfg.orchestrator]?.pane
  if (!pane) return undefined
  const others = new Set([await io.sessionId()])
  for (const [name, rec] of Object.entries(records)) if (name !== cfg.orchestrator && rec.session) others.add(rec.session)
  return agents.find(a => a.pane_id === pane && !others.has(a.agent_session?.value ?? ''))
}

/** Records this session as `envoy_session`, and starts a new orchestrator when its session is gone. */
export async function reattach(io: Io): Promise<string> {
  const cfg = await readConfig(io)
  if (!cfg) return 'No team run in this repo: start one with /team:init <ticket>.'
  const id = await io.sessionId()
  // Rule 16: the orchestrator never talks to the human, so its session cannot be the envoy.
  if (cfg.orchestrator_session === id) {
    return `This session runs the orchestrator of ${cfg.team_id}; run /team-envoy in the session you talk to.`
  }
  const path = `${await teamDir(io)}/config.json`
  // Read again right before the write: the orchestrator's mod may have written a /clear meanwhile.
  const latest = (await readJson<TeamConfig>(io, path)) ?? cfg
  await writeJson(io, path, { ...latest, envoy_session: id })
  return [`This session is the envoy of ${cfg.team_id} now.`, await orchestratorLine(io, latest)].join(' ')
}

async function orchestratorLine(io: Io, cfg: TeamConfig): Promise<string> {
  const listed = await herdrAgents(io)
  if (!listed.ok) {
    return `Cannot tell whether the orchestrator runs (${listed.reason}); started none. Run /team-envoy again when herdr answers.`
  }
  const sid = cfg.orchestrator_session
  const alive = await liveOrchestrator(io, cfg, listed.agents)
  if (alive) return `The orchestrator runs (${alive.pane_id}); left alone.`
  const why = sid ? `The orchestrator session ${sid} is gone` : 'No orchestrator session is recorded'
  const r = await io.run([`${io.pluginRoot}/bin/team-orch-start`], START_TIMEOUT_MS)
  if (r.exitCode === STARTING) {
    // Exit 5 is either the start lock of another start or a live orchestrator found under the lock.
    const runs = /an orchestrator runs \(([^)]*)\)/.exec(r.stderr)
    return runs ? `${why}, but an orchestrator runs (${runs[1]}); left alone.` : `${why}, but an orchestrator is starting; left alone.`
  }
  if (r.exitCode !== 0) {
    const reason = (r.stderr || r.stdout).trim() || `team-orch-start failed (${r.exitCode})`
    const dialog = reason.includes('is at a startup dialog')
      ? ' Answer the dialog in that pane, close the pane, then run /team-envoy again.'
      : ''
    return `The orchestrator is gone and no new one started: ${reason}${dialog}`
  }
  const got = Object.fromEntries(r.stdout.trim().split(/\s+/).map(kv => kv.split('=', 2) as [string, string]))
  return `${why}: started a new orchestrator ${got.orchestrator} (${got.pane}, ${got.session}) from zero.`
}
