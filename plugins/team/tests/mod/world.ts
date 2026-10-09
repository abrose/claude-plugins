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
  cwd: string
  team: string
  files: Map<string, { text: string; mtimeMs: number }>
  agents: HerdrAgent[]
  panes: HerdrPane[]
  herdrFails: string | null
  /** The next prompt.submit throws, once. */
  submitFails: boolean
  /** The next fs.write throws, once. */
  writeFails: boolean
  /** Runs after each fs.read answered, to stand for a writer in another process. */
  afterRead?: (path: string) => void
  /** Directories made with mkdir, which have no file under them. */
  dirs: Set<string>
  /** Paths another process claims first: the next plain mkdir of one finds it already there. */
  raceMkdir: Set<string>
  statuses: (string | undefined)[]
  toasts: string[]
  /** session.send answers not delivered, with this reason. */
  sendFails: string | null
  titles: Map<string, string>
  /** Pane ids that open but stay undrawn (isPlaced false), like in a herdr pane under 144 columns. */
  unplaced: Set<string>
  runs: string[][]
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
    team: `${CWD}/scratchpad/current/.team`,
    files: new Map(),
    agents: [],
    panes: [],
    herdrFails: null,
    submitFails: false,
    writeFails: false,
    dirs: new Set(),
    raceMkdir: new Set(),
    statuses: [],
    toasts: [],
    sendFails: null,
    titles: new Map(),
    unplaced: new Set(),
    runs: [],
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
    const f = w.files.get(e.path)
    w.afterRead?.(e.path)
    return f ? { value: f.text } : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.write', ($, e) => {
    if (w.writeFails) {
      w.writeFails = false
      throw new Error('write refused')
    }
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
    const out = (stdout: string, exitCode = 0, stderr = '') => ({
      value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const bin = argv[0] ?? ''
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
    if (w.herdrFails) return out('', 1, w.herdrFails)
    const sub = argv.slice(1, 3).join(' ')
    if (sub === 'agent list') return out(JSON.stringify({ result: { agents: w.agents } }))
    if (sub === 'pane list') return out(JSON.stringify({ result: { panes: w.panes } }))
    if (sub === 'agent read') return out('Allow Bash(rm -rf build)? [y/n]\n')
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
    return { text: e.text }
  })
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
