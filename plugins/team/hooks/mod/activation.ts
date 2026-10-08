import { readJson, writeJson } from './io'
import type { Io } from './io'
import { teamDir } from './paths'

export type TeamConfig = {
  team_id: string
  ticket: string
  orchestrator: string
  orchestrator_session?: string
  orchestrator_tab?: string
  envoy_session?: string
  envoy_tab?: string
}

let clearedFrom: string | null = null

export const noteClear = (oldId: string) => {
  clearedFrom = oldId
}

/** Without envoy_session the orchestrator session also holds the envoy role. */
export function roleOf(cfg: TeamConfig | null, id: string): { orchestrator: boolean; envoy: boolean } {
  const orchestrator = !!cfg && cfg.orchestrator_session === id
  const envoy = !!cfg && (cfg.envoy_session ? cfg.envoy_session === id : orchestrator)
  return { orchestrator, envoy }
}

async function followClear(io: Io): Promise<void> {
  if (clearedFrom === null) return
  const old = clearedFrom
  clearedFrom = null
  const path = `${await teamDir(io)}/config.json`
  const cfg = await readJson<TeamConfig>(io, path)
  const id = await io.sessionId()
  await io.setSessionEnv(id)
  if (!cfg || old === id) return
  const moved = {
    ...cfg,
    ...(cfg.orchestrator_session === old ? { orchestrator_session: id } : {}),
    ...(cfg.envoy_session === old ? { envoy_session: id } : {}),
  }
  if (moved.orchestrator_session !== cfg.orchestrator_session || moved.envoy_session !== cfg.envoy_session) {
    await writeJson(io, path, moved)
  }
}

// Follows a pending /clear first, so a command or tool call right after one
// does not wait for the next tick to find the team.
export async function activeConfig(io: Io): Promise<TeamConfig | null> {
  await followClear(io)
  const cfg = await readJson<TeamConfig>(io, `${await teamDir(io)}/config.json`)
  if (!cfg?.orchestrator_session) return null
  return cfg.orchestrator_session === (await io.sessionId()) ? cfg : null
}

/** The run config when this session holds the envoy role, else null. */
export async function envoyConfig(io: Io): Promise<TeamConfig | null> {
  await followClear(io)
  const cfg = await readJson<TeamConfig>(io, `${await teamDir(io)}/config.json`)
  if (!cfg?.orchestrator_session) return null
  return roleOf(cfg, await io.sessionId()).envoy ? cfg : null
}
