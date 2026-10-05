import type { Io } from './io'

let sessionCwd = ''

export const setCwd = (cwd: string) => {
  sessionCwd = cwd
}

export async function runDir(io: Io): Promise<string> {
  const scratch = (await io.envGet('TEAM_SCRATCH')) ?? 'scratchpad/current'
  return scratch.startsWith('/') ? scratch : `${sessionCwd}/${scratch}`
}

export async function teamDir(io: Io): Promise<string> {
  return `${await runDir(io)}/.team`
}
