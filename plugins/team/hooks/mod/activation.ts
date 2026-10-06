import { readJson, writeJson } from './io'
import type { Io } from './io'
import { teamDir } from './paths'

export type TeamConfig = {
  team_id: string
  ticket: string
  orchestrator: string
  orchestrator_session?: string
  orchestrator_tab?: string
}

let clearedFrom: string | null = null

export const noteClear = (oldId: string) => {
  clearedFrom = oldId
}

async function followClear(io: Io): Promise<void> {
  if (clearedFrom === null) return
  const old = clearedFrom
  clearedFrom = null
  const path = `${await teamDir(io)}/config.json`
  const cfg = await readJson<TeamConfig>(io, path)
  const id = await io.sessionId()
  await io.setSessionEnv(id)
  if (cfg && cfg.orchestrator_session === old && old !== id) {
    await writeJson(io, path, { ...cfg, orchestrator_session: id })
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
