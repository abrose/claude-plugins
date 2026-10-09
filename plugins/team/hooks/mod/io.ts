export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type ToolResult = { result: string; isError?: true }

/** Everything the mod's logic needs from the engine, built over `$` in team.tsx. */
export type Io = {
  sessionId: () => Promise<string>
  /**
   * The project root, absolute: the main checkout of the session's root (the same from a linked
   * worktree). A shell `cd` does not move it. Cached per session root, so git runs once.
   */
  root: () => Promise<string>
  envGet: (name: 'TEAM_SCRATCH' | 'HERDR_BIN_PATH') => Promise<string | undefined>
  setSessionEnv: (id: string) => Promise<void>
  readText: (path: string) => Promise<string | null>
  writeText: (path: string, text: string) => Promise<void>
  list: (dir: string) => Promise<string[]>
  mtime: (path: string) => Promise<number | null>
  run: (argv: string[], timeoutMs?: number) => Promise<RunResult>
  sleep: (ms: number) => Promise<void>
  now: () => Promise<number>
  sendTo: (sessionId: string, text: string) => Promise<{ isDelivered: boolean; reason?: string }>
  pluginRoot: string
}

export async function readJson<T>(io: Io, path: string): Promise<T | null> {
  const text = await io.readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export async function writeJson(io: Io, path: string, value: unknown): Promise<void> {
  await io.writeText(path, JSON.stringify(value))
}

export async function tailText(io: Io, path: string, bytes: number): Promise<string> {
  const r = await io.run(['tail', '-c', String(bytes), path])
  return r.exitCode === 0 ? r.stdout : ''
}
