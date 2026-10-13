import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

export type HerdrAgent = {
  pane_id: string
  tab_id?: string
  agent_status: string
  agent_session?: { value: string }
  name?: string
}
export type HerdrPane = { pane_id: string; tab_id: string; agent_status: string }

export type World = {
  store: Map<string, unknown>
  id: string
  /** The session's current directory. A test moves it to stand for a shell `cd`. */
  cwd: string
  /** The session's project root: a shell `cd` does not move it. */
  root: string
  team: string
  files: Map<string, { text: string; mtimeMs: number }>
  agents: HerdrAgent[]
  panes: HerdrPane[]
  herdrFails: string | null
  /**
   * Calls that fail with this stderr, by "agent prompt", "pane close", "team-forget", "team-release" or
   * "team-orch-start". A "team-release" value is the script's stderr, `<step>: <reason>`; one that starts
   * with `lock:` stands for the held lock (exit 5), any other for a failed step (exit 1).
   */
  fails: Map<string, string>
  /**
   * What `herdr agent read` answers per pane id. A pane without an entry gets DIALOG_SNAPSHOT. A "agent read"
   * entry in `fails` makes every read fail.
   */
  dialogs: Map<string, string>
  /** team-orch-start finds the start lock of another start and refuses with exit 5. */
  orchLocked: boolean
  /** team-orch-start finds a live orchestrator in this pane after it takes the lock and refuses with exit 5. */
  orchRunsIn: string
  /** The next prompt.submit throws, once. */
  submitFails: boolean
  /** What `$.prompt.read()` answers: the draft in the prompt box ('' for none). */
  draft: string
  /** The next prompt.submit calls each wait on one of these, in order: it is recorded in `submits` at once, answers when the promise settles. */
  holdSubmits: Promise<void>[]
  /** The next `herdr agent list` waits on this, once: it holds a tick open. */
  holdList: Promise<void> | null
  /** The next team-release calls each wait on one of these, in order: the call is recorded in `runs` at once, answers when the promise settles. */
  holdReleases: Promise<void>[]
  /** The next fs.write throws, once. */
  writeFails: boolean
  /** Every fs.write to a path that starts with one of these throws, until the entry is removed. */
  writeFailsAt: Set<string>
  /** Paths that exist (stat answers) but whose read is refused, like a permission error. */
  unreadable: Set<string>
  /** The text of the plugin's own `.claude-plugin/plugin.json`; null means the file is missing. */
  pluginJson: string | null
  /** Runs after each fs.read answered, to stand for a writer in another process. */
  afterRead?: (path: string) => void
  /** Directories made with mkdir, which have no file under them. */
  dirs: Set<string>
  /** Paths another process claims first: the next plain mkdir of one finds it already there. */
  raceMkdir: Set<string>
  statuses: (string | undefined)[]
  toasts: string[]
  /** The timeoutMs each toast in `toasts` carried (undefined: none), same order. */
  toastMs: (number | undefined)[]
  /** session.send answers not delivered, with this reason. */
  sendFails: string | null
  titles: Map<string, string>
  /** Pane ids that open but stay undrawn (isPlaced false), like in a herdr pane under 144 columns. */
  unplaced: Set<string>
  runs: string[][]
  /** The options object of each process.run, parallel to `runs` (undefined when the call passed none). */
  inits: ({ cwd?: string; env?: Record<string, string>; timeoutMs?: number } | undefined)[]
  /** What `git rev-parse` answers: the common git dir and the top level. null means "not a repo" (exit 128). */
  git: { common: string | null; top: string | null }
  /** The cwd of each git call, in order. */
  gitCwds: (string | undefined)[]
  submits: string[]
  sends: { to: unknown; text: string }[]
  env: Map<string, string>
  opened: string[]
  closed: string[]
  clock: ReturnType<typeof mock.clock>
  write: (path: string, text: string, mtimeMs?: number) => void
  writeJson: (path: string, value: unknown, mtimeMs?: number) => void
  json: (path: string) => any
  sessionId: () => string
}

export const CWD = '/proj'

/**
 * What `herdr agent read --lines 20` returns for a blocked pane: the bottom of the screen. History
 * is on top (the first non-empty row is old input), the dialog is in the last non-empty rows,
 * and empty rows follow.
 */
export const DIALOG_SNAPSHOT = [
  '❯ /compact',
  '● Read(src/a.ts)',
  '  ⎿  Read 12 lines',
  '● Bash(rm -rf build)',
  '  Bash command',
  '    rm -rf build',
  '  Allow Bash(rm -rf build)? [y/n]',
  '',
  '',
].join('\n')

/** The WATCH text `herdrDialog` makes from DIALOG_SNAPSHOT: the last three non-empty rows. */
export const DIALOG_TEXT = 'Bash command / rm -rf build / Allow Bash(rm -rf build)? [y/n]'

/**
 * A real Claude Code Bash permission dialog as `herdr agent read --source detection --lines 20`
 * returns it. The input box and footer are gone: the framed dialog is the bottom block.
 */
export const BASH_DIALOG_SNAPSHOT = [
  ' #1 ❯ Run this exact Bash command and nothing else: python3 -c "print(1)"',
  '',
  ' · | 🤖 Run python print test | 💬 | - | - | - |',
  '                                                                                    Ran 1 command · last: python3 -c "print(1)" ●',
  '',
  '─'.repeat(126),
  ' Bash command',
  ' Run python3 print command',
  '╌'.repeat(126),
  ' python3 -c "print(1)"',
  '╌'.repeat(126),
  ' │ python3 runs inline code, which cannot be checked against the read block; under the read block',
  ' │ (permissions.blockReadsOutsideWorkingDirectories) a command the shell parser cannot analyze asks the person',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n')

/** The WATCH text `herdrDialog` makes from BASH_DIALOG_SNAPSHOT. */
export const BASH_DIALOG_TEXT = 'Bash command / python3 -c "print(1)" / Do you want to proceed?'

export const start = ($: any) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

/** A started orchestrator session with an active team and one worker record. */
export async function team($: any, on: On): Promise<World> {
  const w = world(on)
  await start($)
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
  })
  w.writeJson(`${w.team}/app-1-scout.json`, {
    role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout',
  })
  return w
}

export const call = ($: any, tool: string, args: object) =>
  $.tool.call({ tool: `mcp__team__${tool}`, tool_use_id: 't1', ...args } as never)

export const CARD = {
  context: 'Fixtures load from a snapshot. The snapshot is 3 weeks old.',
  question: 'Use real fixtures or the snapshot?',
  options: [{ option: 'real fixtures', cost: '~1 h' }, { option: 'snapshot', cost: 'none' }],
  recommendation: 'real fixtures: the snapshot hides the bug',
  blocks: 'the whole task',
  door: 'two-way',
  rework: '~1 h: swap the fixture loader',
  parked: false,
}

/** Writes card Q-<n> as the mod would, with CARD's fields unless overridden. */
export function card(w: World, n: number, fields: object = {}) {
  const { parked, ...rest } = CARD
  w.writeJson(`${w.team}/questions/Q-${n}.json`, {
    id: `Q-${n}`, n, from: 'app-1-scout', tag: 'general', ...rest,
    urgent: false, refs: [], status: parked ? 'assumed' : 'open', at: w.clock.now(), ...fields,
  })
}

/** A started envoy session: the config names it envoy_session; the orchestrator is another session. */
export async function envoyTeam($: any, on: On): Promise<World> {
  const w = world(on)
  await start($)
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
    orchestrator_session: 'sid-orch-worker', envoy_session: w.id,
  })
  w.writeJson(`${w.team}/app-1-scout.json`, {
    role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout',
  })
  return w
}

/** The agent rows the pane draws, read through the drawing. */
export async function agentRows($: any): Promise<string[]> {
  const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                requestId: 'team', props: { bodyColumns: 80 } } as never)
  const found = await ui.findAll({ type: 'Button', text: /app-1-/ })
  return found.map((f: any) => f.text.trim().replace(/\s+/g, ' '))
}

export function world(on: On): World {
  const clock = mock.clock(on, { now: 1_000_000 })
  const w: World = {
    store: new Map(),
    id: 'sid-orch',
    cwd: CWD,
    root: CWD,
    team: `${CWD}/scratchpad/current/.team`,
    files: new Map(),
    agents: [],
    panes: [],
    herdrFails: null,
    fails: new Map(),
    dialogs: new Map(),
    orchLocked: false,
    orchRunsIn: '',
    submitFails: false,
    draft: '',
    holdSubmits: [],
    holdList: null,
    holdReleases: [],
    writeFails: false,
    writeFailsAt: new Set(),
    unreadable: new Set(),
    pluginJson: null,
    dirs: new Set(),
    raceMkdir: new Set(),
    statuses: [],
    toasts: [],
    toastMs: [],
    sendFails: null,
    titles: new Map(),
    unplaced: new Set(),
    runs: [],
    inits: [],
    git: { common: null, top: null },
    gitCwds: [],
    submits: [],
    sends: [],
    env: new Map(),
    opened: [],
    closed: [],
    clock,
    write: (path, text, mtimeMs) => w.files.set(path, { text, mtimeMs: mtimeMs ?? clock.now() }),
    writeJson: (path, value, mtimeMs) => w.write(path, JSON.stringify(value), mtimeMs),
    json: path => JSON.parse(w.files.get(path)!.text),
    sessionId: () => w.env.get('TEAM_SESSION_ID') ?? '',
  }

  on('session.id', () => ({ value: w.id }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.root', () => ({ value: w.root }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__team__${e.name}` } }))
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/.claude-plugin/plugin.json')) {
      return w.pluginJson === null ? { deny: `ENOENT: ${e.path}` } : { value: w.pluginJson }
    }
    const f = w.files.get(e.path)
    w.afterRead?.(e.path)
    if (f && w.unreadable.has(e.path)) return { deny: `EACCES: ${e.path}` }
    return f ? { value: f.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', ($, e) => {
    if (w.writeFails) {
      w.writeFails = false
      throw new Error('write refused')
    }
    if ([...w.writeFailsAt].some(p => e.path.startsWith(p))) throw new Error(`write refused: ${e.path}`)
    w.write(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) }))
  on('fs.stat', ($, e) => {
    const f = w.files.get(e.path)
    return f
      ? { value: { kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
      : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', ($, e) => {
    const prefix = e.path.endsWith('/') ? e.path : `${e.path}/`
    const names = new Set<string>()
    for (const p of [...w.files.keys(), ...w.dirs]) {
      if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0] ?? '')
    }
    return {
      value: [...names].map(name => {
        const f = w.files.get(prefix + name)
        return f
          ? { name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false }
          : { name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }
      }),
    }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    w.inits.push(e.init)
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const bin = argv[0] ?? ''
    if (bin === 'git') {
      w.gitCwds.push(e.init?.cwd)
      const answer = argv.includes('--git-common-dir') ? w.git.common : w.git.top
      return answer === null ? out('', 128, 'fatal: not a git repository') : out(`${answer}\n`)
    }
    if (bin === 'mv') {
      const failure = w.fails.get('mv')
      if (failure) return out('', 1, failure)
      const [from, to] = [argv[1] ?? '', argv[2] ?? '']
      const f = w.files.get(from)
      if (!f) return out('', 1, `mv: ${from}: No such file or directory`)
      w.files.delete(from)
      w.files.set(to, { text: f.text, mtimeMs: clock.now() })
      return out('')
    }
    if (bin === 'tail') return out(w.files.get(argv[argv.length - 1] ?? '')?.text ?? '')
    if (bin === 'mkdir') {
      const p = argv[argv.length - 1] ?? ''
      if (argv[1] === '-p') {
        w.dirs.add(p)
        return out('')
      }
      if (w.raceMkdir.has(p)) w.dirs.add(p)
      if (w.dirs.has(p)) return out('', 1, `mkdir: ${p}: File exists`)
      w.dirs.add(p)
      return out('')
    }
    if (bin.endsWith('/bin/team-brief')) {
      return out(`Read scratchpad/current/brief-${argv[2]}-${argv[4]}.md and execute it fully.\n`)
    }
    if (bin.endsWith('/bin/team-forget')) {
      const name = argv[1] ?? ''
      const failure = w.fails.get('team-forget')
      if (failure) return out('', 1, failure)
      const session = (w.files.has(`${w.team}/${name}.json`) ? w.json(`${w.team}/${name}.json`) : {}).session
      if (w.agents.some(a => a.agent_session?.value === session)) return out('', 1, `${name} is still live: close its pane first`)
      w.files.delete(`${w.team}/${name}.json`)
      return out(`forgot ${name}\n`)
    }
    if (bin.endsWith('/bin/team-release')) {
      // Stands for the script: it clears, closes the pane and forgets the record of the named agent.
      const name = argv[1] ?? ''
      const answer = () => {
        const failure = w.fails.get('team-release')
        if (failure) return out('', failure.startsWith('lock:') ? 5 : 1, failure)
        const record = w.files.has(`${w.team}/${name}.json`) ? w.json(`${w.team}/${name}.json`) : undefined
        if (!record) return out(`no record: ${name}\n`)
        w.agents = w.agents.filter(a => a.agent_session?.value !== record.session)
        w.panes = w.panes.filter(p => p.pane_id !== record.pane)
        w.files.delete(`${w.team}/${name}.json`)
        return out(`forgot ${name}\n`)
      }
      const hold = w.holdReleases.shift()
      return hold ? hold.then(answer) : answer()
    }
    if (bin.endsWith('/bin/team-orch-start')) {
      // Stands for team-start in a new tab, then the config writes of the real script.
      const failure = w.fails.get('team-orch-start')
      if (failure) return out('', 4, failure)
      if (w.orchLocked) return out('', 5, `an orchestrator is starting: ${w.team}/orch-starting is 12 s old; left alone`)
      if (w.orchRunsIn) return out('', 5, `an orchestrator runs (${w.orchRunsIn}); left alone`)
      const path = `${w.team}/config.json`
      w.writeJson(path, { ...w.json(path), orchestrator_session: 'sid-orch-new', orchestrator_tab: 'w1:t20' })
      return out('orchestrator=app-1-orch session=sid-orch-new pane=w1:p20 tab=w1:t20\n')
    }
    if (w.herdrFails) return out('', 1, w.herdrFails)
    const sub = argv.slice(1, 3).join(' ')
    if (sub === 'agent list') {
      const hold = w.holdList
      w.holdList = null
      const answer = out(JSON.stringify({ result: { agents: w.agents } }))
      return hold ? hold.then(() => answer) : answer
    }
    if (sub === 'pane list') return out(JSON.stringify({ result: { panes: w.panes } }))
    if (sub === 'agent read') {
      const failure = w.fails.get(sub)
      if (failure) return out('', 1, failure)
      return out(w.dialogs.get(argv[3] ?? '') ?? DIALOG_SNAPSHOT)
    }
    // /clear never starts a turn, so herdr answers a prompt of it with agent_prompt_stalled.
    if (sub === 'agent prompt') return out('', 1, w.fails.get(sub) ?? 'agent_prompt_stalled')
    if (sub === 'pane close') {
      const failure = w.fails.get(sub)
      if (failure) return out('', 1, failure)
      w.agents = w.agents.filter(a => a.pane_id !== argv[3])
      w.panes = w.panes.filter(p => p.pane_id !== argv[3])
      return out('{"result":{"ok":true}}')
    }
    return out('{"result":{"ok":true}}')
  })
  on('env.get', ($, e) => ({ value: w.env.get(e.name) }))
  on('env.set', ($, e) => {
    if (e.value === undefined) w.env.delete(e.name)
    else w.env.set(e.name, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    if (w.submitFails) {
      w.submitFails = false
      throw new Error('submit refused')
    }
    w.submits.push(e.text)
    const hold = w.holdSubmits.shift()
    return hold ? hold.then(() => ({ text: e.text })) : { text: e.text }
  })
  on('prompt.read', () => ({ value: { text: w.draft, cursor: w.draft.length } }))
  // The engine's bottoms of the turn events and of the auto-mode denial: the plugin under test sits above them.
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('classic.PermissionDenied', () => ({}))
  on('session.send', ($, e) => {
    if (w.sendFails) return { isDelivered: false, reason: w.sendFails }
    w.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    w.toastMs.push(e.timeoutMs)
    return { value: undefined }
  })
  const shown = new Set<string>()
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    shown.add(e.id)
    w.titles.set(e.id, e.title ?? 'Team')
    if (w.unplaced.has(e.id)) return { value: { isPlaced: false, reason: 'narrow terminal' } }
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    shown.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...shown].map(id => ({ id, title: w.titles.get(id) ?? 'Team', isShown: true, isFocused: false, isPlaced: !w.unplaced.has(id) })),
  }))
  return w
}
