import type { Io } from './io'

/**
 * The main checkout of a session root: the parent of the common git dir when that ends in `/.git`
 * (the same from a linked worktree), else the git top level, else the session root. Same rule as
 * `team_project_root` in lib/run-dir.sh. `ask` runs `git rev-parse <args>` from the session root
 * and answers its trimmed stdout, '' when git fails. null means git could not run (timeout, no
 * spawn): the caller must not cache that.
 */
export async function mainCheckout(
  root: string,
  ask: (args: string[]) => Promise<string | null>,
): Promise<string | null> {
  const common = await ask(['--path-format=absolute', '--git-common-dir'])
  if (common === null) return null
  if (common.startsWith('/') && common.endsWith('/.git')) return common.slice(0, -'/.git'.length)
  const top = await ask(['--show-toplevel'])
  if (top === null) return null
  return top || root
}

/**
 * The run directory, absolute. A relative `TEAM_SCRATCH` is joined onto the main checkout of the
 * session's project root (`io.root`), which a shell `cd` does not move. The session's cwd would
 * follow the `cd` and lose the run.
 */
export async function runDir(io: Io): Promise<string> {
  const scratch = (await io.envGet('TEAM_SCRATCH')) ?? 'scratchpad/current'
  return scratch.startsWith('/') ? scratch : `${await io.root()}/${scratch}`
}

export async function teamDir(io: Io): Promise<string> {
  return `${await runDir(io)}/.team`
}
