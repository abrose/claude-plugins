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

export type Role = { orchestrator: boolean; envoy: boolean }

/** Without envoy_session the orchestrator session also holds the envoy role. */
export function roleOf(cfg: TeamConfig | null, id: string): Role {
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
async function readConfig(io: Io): Promise<TeamConfig | null> {
  await followClear(io)
  return readJson<TeamConfig>(io, `${await teamDir(io)}/config.json`)
}

/** The run config and the halves this session holds, or null when it holds none. */
export async function sessionRole(io: Io): Promise<{ cfg: TeamConfig; role: Role } | null> {
  const cfg = await readConfig(io)
  if (!cfg) return null
  const role = roleOf(cfg, await io.sessionId())
  return role.orchestrator || role.envoy ? { cfg, role } : null
}

/** The run config when this session holds the orchestrator role, else null. */
export async function activeConfig(io: Io): Promise<TeamConfig | null> {
  const found = await sessionRole(io)
  return found?.role.orchestrator ? found.cfg : null
}

/** The run config when this session holds the envoy role, else null. The envoy half needs no orchestrator_session. */
export async function envoyConfig(io: Io): Promise<TeamConfig | null> {
  const found = await sessionRole(io)
  return found?.role.envoy ? found.cfg : null
}
