import { readJson, writeJson } from './io'
import type { Io } from './io'
import { teamDir } from './paths'

export type TeamConfig = {
  team_id: string
  ticket: string
  orchestrator: string
  orchestrator_session?: string
}

let clearedFrom: string | null = null

export const noteClear = (oldId: string) => {
  clearedFrom = oldId
}

export async function followClear(io: Io): Promise<void> {
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

export async function activeConfig(io: Io): Promise<TeamConfig | null> {
  const cfg = await readJson<TeamConfig>(io, `${await teamDir(io)}/config.json`)
  if (!cfg?.orchestrator_session) return null
  return cfg.orchestrator_session === (await io.sessionId()) ? cfg : null
}
