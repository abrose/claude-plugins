import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { TeamAgentRow, TeamCard, TeamPlan } from '../../types'
import { envoyConfig, noteClear, sessionRole } from './activation'
import type { TeamConfig } from './activation'
import { badgeText, freshStall, freshUrgent, pickStatus, stallIds, TOAST_MS, toastText } from './badge'
import { BRIEF_TOOL, BRIEF_TOOL_SPEC, briefSend } from './brief'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { bySession, herdrAgents, herdrFocus } from './herdr'
import type { HerdrListing } from './herdr'
import { closeHides, drawPane, drawQuestions, hiddenKey, pruneExpanded, QUESTIONS_PANE, TEAM_PANE } from './pane'
import { mainCheckout, runDir, teamDir } from './paths'
import { parsePlan } from './plan'
import { DECIDE_TOOL_SPEC, decideTool, QUEUE_TOOL_SPEC, queueTool } from './decide'
import { ASK_TOOL_SPEC, askTool, readCards } from './questions'
import { reattach } from './reattach'
import { RELAY_TOOL_SPEC, relayTool } from './relay'
import { pickDecisions } from './decisions'
import { numberMark } from './reports'
import {
  agentRows, idleTabRows, newReportLines, readLedger, readRecords, stallWorkers, syncPanes, watchTick,
} from './tick'
import type { TeamRecord } from './tick'

export const TICK_MS = 15000
const active = atom({ plugin: 'team', key: 'active' } as const, false)
const agents = atom({ plugin: 'team', key: 'agents' } as const, [] as TeamAgentRow[])
const idle = atom({ plugin: 'team', key: 'idleTabs' } as const, [] as string[])
const plan = atom({ plugin: 'team', key: 'plan' } as const, null as TeamPlan | null)
const cards = atom({ plugin: 'team', key: 'cards' } as const, [] as TeamCard[])
const expanded = atom({ plugin: 'team', key: 'expandedCards' } as const, [] as string[])
const urgent = atom({ plugin: 'team', key: 'urgent' } as const, 0)
const planPath = atom({ plugin: 'team', key: 'planPath' } as const, '')
const tickAt = atom({ plugin: 'team', key: 'tickAt' } as const, '')
const error = atom({ plugin: 'team', key: 'error' } as const, '')
// One tick loop per module: a second session.start replaces it, never adds one.
let tickTimer: Timer | null = null
// True while a tick runs: a tick that finds it set returns at once.
let ticking = false
// Lines of a rejected send, in order. The next tick that sends puts them first. Memory only: a mod restart
// loses them. A new session.start (a /clear) keeps them.
let retryLines: string[] = []
// The status text this module set last; null until a session sets one, so its first tick always sets the line.
let lastBadge: string | undefined | null = null

// The main checkout, resolved once per session root: the 15 s tick must not spawn git every time.
// Keyed by the session root, which moves on a /cd. A git that could not run is not cached.
let mainRoot: { from: string; path: string } | null = null

async function projectRoot($: EngineInterface): Promise<string> {
  const from = await $.session.root()
  if (mainRoot?.from === from) return mainRoot.path
  const path = await mainCheckout(from, async args => {
    try {
      const r = await $.process.run(['git', 'rev-parse', ...args], { cwd: from, timeoutMs: 5000 })
      return r.exitCode === 0 ? r.stdout.trim() : ''
    } catch {
      return null
    }
  })
  if (path === null) return from
  mainRoot = { from, path }
  return path
}

function makeIo($: EngineInterface): Io {
  // Every team script resolves its run dir from the main checkout (lib/run-dir.sh). The mod hands
  // it the absolute run dir and the main checkout as cwd, so a script never depends on the env or
  // the cwd the engine inherits. An absolute TEAM_SCRATCH needs no git (see main-checkout.test.ts):
  // it passes the env alone and leaves the cwd to the engine.
  // Shared by io.run and io.rename; it reads `io` only when called, after io exists.
  const run: Io['run'] = async (argv, timeoutMs = 10000) => {
    try {
      const scratch = await $.env.get('TEAM_SCRATCH')
      if (scratch?.startsWith('/')) return await $.process.run(argv, { env: { TEAM_SCRATCH: scratch }, timeoutMs })
      const cwd = await projectRoot($)
      const env = { TEAM_SCRATCH: await runDir(io) }
      return await $.process.run(argv, { cwd, env, timeoutMs })
    } catch (err) {
      return { exitCode: -1, stdout: '', stderr: String(err) }
    }
  }
  const io: Io = {
    sessionId: () => $.session.id(),
    root: () => projectRoot($),
    envGet: async name =>
      name === 'TEAM_SCRATCH' ? $.env.get('TEAM_SCRATCH') : $.env.get('HERDR_BIN_PATH'),
    setSessionEnv: id => $.env.set('TEAM_SESSION_ID', id),
    readText: async path => {
      try {
        const text = await $.fs.read(path)
        return typeof text === 'string' ? text : null
      } catch {
        return null
      }
    },
    writeText: (path, text) => $.fs.write(path, text),
    // mv in one directory is a rename(2). Whether the engine has $.fs.rename is not known from the repo.
    rename: async (from, to) => {
      const r = await run(['mv', from, to])
      if (r.exitCode !== 0) throw new Error(`mv ${to} failed: ${r.stderr.trim()}`)
    },
    list: async dir => {
      try {
        return (await $.fs.list(dir)).map(e => e.name)
      } catch {
        return []
      }
    },
    mtime: async path => {
      try {
        return (await $.fs.stat(path)).mtimeMs
      } catch {
        return null
      }
    },
    run,
    sleep: ms => $.clock.sleep(ms),
    now: () => $.clock.now(),
    sendTo: async (sessionId, text) => {
      const sent = await $.session.send({ to: { sessionId }, text })
      return sent.isDelivered ? { isDelivered: true } : { isDelivered: false, reason: sent.reason }
    },
    pluginRoot: $.plugin.root,
  }
  return io
}

// Both tabs open on the first activation and on show; the last one opened is the one shown.
async function openPanes($: EngineInterface): Promise<void> {
  await $.ui.open({ id: TEAM_PANE, title: 'Team' })
  await $.ui.open({ id: QUESTIONS_PANE, title: 'Questions' })
}

// A person's close of either tab closes the other one too and stores hidden:
// the choice is per run, not per tab.
async function hideForRun($: EngineInterface): Promise<void> {
  const cfg = await envoyConfig(makeIo($))
  if (!cfg) return
  await $.store.set(hiddenKey(cfg.team_id), true)
  const open = (await $.ui.panes()).map(p => p.id)
  for (const id of [TEAM_PANE, QUESTIONS_PANE]) if (open.includes(id)) await $.ui.close({ id })
}

async function showPanes($: EngineInterface, teamId: string): Promise<void> {
  if ((await $.store.get(hiddenKey(teamId))) === true) return
  await openPanes($)
}

const NOT_SENT = 'prompt not sent: '

/** The tabs layout hygiene and the release leave alone, besides the tab of the session itself. */
const exemptTabs = (cfg: TeamConfig) => [cfg.orchestrator_tab, cfg.envoy_tab].filter((t): t is string => !!t)

/** Sets the status line when its text differs from the one this module set last. */
async function setStatus($: EngineInterface, text: string | undefined): Promise<void> {
  if (text === lastBadge) return
  await $.ui.status(text)
  lastBadge = text
}

/**
 * The orchestrator half: keeps records true, then sends REPORT, DECISION and WATCH lines as one prompt.
 * `split` is true when another session is the envoy: no pane shows the error, so the status line does.
 */
async function orchestratorHalf(
  $: EngineInterface, io: Io, cfg: TeamConfig, teamdir: string,
  records: Record<string, TeamRecord>, listed: HerdrListing, split: boolean,
): Promise<void> {
  await syncPanes(io, teamdir, records, listed)
  const run = await runDir(io)
  const now = await $.clock.now()
  // A card still waiting for the human (open, or parked and so assumed) holds its sender's release back.
  const waiting = new Set((await readCards(io, teamdir))
    .filter(c => c.status === 'open' || c.status === 'assumed').map(c => c.from))
  // A delivered.json that cannot be used holds REPORT and DECISION lines only. The watch rules, the layout
  // hygiene and the release run anyway: they have no use for the marks, and a person must see the outage.
  const reports = await newReportLines(io, run, teamdir, records)
  const watch = await watchTick(io, run, teamdir, records, listed, now, await $.session.id(), exemptTabs(cfg), waiting,
    { broken: reports.unreadable, path: reports.path })
  let fresh = watch
  let failure: unknown = reports.unreadable ? new Error('delivered.json does not parse') : null
  if (!reports.unreadable) {
    const decisions = pickDecisions(await readLedger(io, teamdir), numberMark(reports.delivered, '_decision'))
    // The marks go first: a submit waits while the session is busy, and a later tick must not pick the same lines again.
    // When the write fails, REPORT and DECISION lines wait (the marks did not move, so the next tick picks them
    // again); this tick's WATCH lines are not picked again, so they go out now.
    try {
      await reports.commit({ _decision: decisions.mark })
      fresh = [...reports.lines, ...decisions.lines, ...watch]
    } catch (err) {
      failure = err
    }
  }
  if (failure !== null) await showNotSent($, failure, split)
  // Lines of a rejected send go first. The list is emptied as the submit is called, so a later tick cannot send them twice.
  const lines = [...retryLines, ...fresh.filter(l => !retryLines.includes(l))]
  if (lines.length === 0) return
  retryLines = []
  // Not awaited: the tick ends here, and the submit settles whenever the session takes the prompt.
  void sendLines($, lines, split, failure !== null).catch(err => showNotSentSafely($, err, split))
}

async function showNotSent($: EngineInterface, err: unknown, split: boolean): Promise<void> {
  const text = `${NOT_SENT}${String(err).slice(0, 160)}`
  await update($, error, () => text)
  if (split) await setStatus($, text)
}

/** The display of an error that cannot throw: when it fails, nothing is left to tell. */
async function showNotSentSafely($: EngineInterface, err: unknown, split: boolean): Promise<void> {
  try {
    await showNotSent($, err, split)
  } catch {
    // The display itself failed, so there is nothing left to tell; the lines are in the retry list.
  }
}

/**
 * Sends one prompt. A failed send keeps its lines in `retryLines`, so the next tick that sends puts them
 * first in its bundle. The marks stay where they are. The list is memory only: a restart loses it.
 * A good send clears the `prompt not sent` status line unless `keepError` is set.
 */
async function sendLines($: EngineInterface, lines: string[], split: boolean, keepError = false): Promise<void> {
  try {
    await $.prompt.submit({ text: lines.join('\n') })
  } catch (err) {
    // Only a rejected submit fills the list.
    retryLines = [...retryLines, ...lines.filter(l => !retryLines.includes(l))]
    await showNotSent($, err, split)
    return
  }
  // The lines are sent. A throw from here on goes to the caller's catch and never fills the list.
  // `keepError`: this tick shows an error of its own (a broken or unwritable delivered.json); a send of WATCH lines must not clear it.
  if (split && !keepError && lastBadge?.startsWith(NOT_SENT)) await setStatus($, undefined)
}

/** Test-only access to the module state; the mod itself never calls it. */
export const testing = {
  reset: () => {
    retryLines = []
    ticking = false
    lastBadge = null
  },
  retryLines: () => [...retryLines],
  setBadge: (text: string | undefined | null) => {
    lastBadge = text
  },
  sendLines,
}

/** The envoy half: the plan, the cards and the agent rows the panes draw. */
async function envoyHalf(
  $: EngineInterface, io: Io, cfg: TeamConfig, teamdir: string,
  records: Record<string, TeamRecord>, listed: HerdrListing,
): Promise<void> {
  const path = `${await runDir(io)}/progress-${cfg.ticket}.md`
  const text = await io.readText(path)
  await update($, planPath, () => path)
  await update($, plan, () => (text === null ? null : parsePlan(text)))
  const found = await readCards(io, teamdir)
  await update($, cards, () => found)
  const rows = agentRows(records, listed)
  await update($, agents, () => rows)
  const myId = await $.session.id()
  const idleRows = await idleTabRows(io, await runDir(io), teamdir, records, listed, myId, exemptTabs(cfg))
  await update($, idle, () => idleRows.rows)
  await update($, error, () => (listed.ok ? '' : `herdr: ${listed.reason}`))
  // The orchestrator has no record: herdr's listing, by the session the config names, tells its state.
  const orchestrator = listed.ok && cfg.orchestrator_session
    ? bySession(listed.agents).get(cfg.orchestrator_session)?.agent_status
    : undefined
  const stall = stallIds({
    cards: found,
    herdrUp: listed.ok,
    workers: stallWorkers(records, rows, idleRows.briefed, myId),
    orchestrator,
  })
  await urgentBadge($, io, teamdir, found, stall)
}

/**
 * The status line and the toasts; neither starts a turn. The line is, in this order: a `prompt not sent`
 * error (set only in an orchestrator-only session, and kept while it shows), the urgent badge, the stall
 * text. Each new urgent card gets one toast, and each stall episode one toast, whatever the line shows.
 * `stall` is `stallIds`: the open cards while the whole team waits on the human, else null.
 */
async function urgentBadge(
  $: EngineInterface, io: Io, teamdir: string, found: TeamCard[], stall: string[] | null,
): Promise<void> {
  await update($, urgent, () => found.filter(c => c.urgent && (c.status === 'open' || c.status === 'assumed')).length)
  const marksPath = `${teamdir}/toasted.json`
  const read = await readJson<string[]>(io, marksPath)
  const fresh = freshUrgent(found, read)
  const waiting = freshStall(stall, found.some(c => c.status === 'open'), fresh.seen, await $.clock.now())
  const notSent = lastBadge?.startsWith(NOT_SENT) ? lastBadge : undefined
  await setStatus($, pickStatus(notSent, badgeText(found), waiting.text))
  for (const c of fresh.toast) await $.ui.toast(toastText(c), { timeoutMs: TOAST_MS })
  if (waiting.toast !== undefined) await $.ui.toast(waiting.toast, { timeoutMs: TOAST_MS })
  await writeJson(io, marksPath, waiting.seen)
}

/** The timer does not wait for a tick (its callback returns void), so a slow tick would overlap the next one. */
async function tick($: EngineInterface, io: Io): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await tickOnce($, io)
  } finally {
    ticking = false
  }
}

async function tickOnce($: EngineInterface, io: Io): Promise<void> {
  const held = await sessionRole(io)
  const was = await read($, active)
  await update($, active, () => held !== null)
  // Every team status line belongs to a role. Clear it once when the session loses its role. A session
  // that still holds only the orchestrator role keeps its `prompt not sent` line: a good submit clears it.
  const keepsError = !!held?.role.orchestrator && !!lastBadge?.startsWith(NOT_SENT)
  if (!held?.role.envoy && lastBadge && !keepsError) await setStatus($, undefined)
  if (!held) return
  const { cfg, role } = held
  if (role.envoy && !was) await showPanes($, cfg.team_id)

  const teamdir = await teamDir(io)
  const listed = await herdrAgents(io)
  const records = await readRecords(io, teamdir)
  // The envoy half first: the orchestrator half may report a failed prompt, which must not be cleared.
  if (role.envoy) await envoyHalf($, io, cfg, teamdir, records, listed)
  if (role.orchestrator) await orchestratorHalf($, io, cfg, teamdir, records, listed, !role.envoy)

  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  await update($, tickAt, () => at)
}

export const register: Register = on => {
  mainRoot = null
  on('session.start', async ($, e, next) => {
    const io = makeIo($)
    await $.env.set('TEAM_SESSION_ID', await $.session.id())
    lastBadge = null
    await $.command.register({ name: 'team-overview', description: 'Show or hide the Team and Questions tabs' })
    await $.command.register({
      name: 'team-envoy',
      description: 'Make this session the envoy of the live team run; starts a new orchestrator if its session is gone',
    })
    await $.tool.register(BRIEF_TOOL_SPEC)
    await $.tool.register(ASK_TOOL_SPEC)
    await $.tool.register(QUEUE_TOOL_SPEC)
    await $.tool.register(DECIDE_TOOL_SPEC)
    await $.tool.register(RELAY_TOOL_SPEC)
    tickTimer?.cancel()
    tickTimer = $.clock.every(TICK_MS, () => tick($, io))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') noteClear(e.sessionId)
    return next(e)
  })

  on('tool.call', { tool: `mcp__team__${BRIEF_TOOL}` }, async ($, e) =>
    briefSend(makeIo($), String(e.name ?? ''), String(e.topic ?? '')))

  on('tool.call', { tool: 'mcp__team__ask' }, async ($, e) => askTool(makeIo($), e))

  on('tool.call', { tool: 'mcp__team__queue' }, async ($, e) => queueTool(makeIo($), e))

  on('tool.call', { tool: 'mcp__team__decide' }, async ($, e) => decideTool(makeIo($), e))

  on('tool.call', { tool: 'mcp__team__relay' }, async ($, e) => relayTool(makeIo($), e))

  on('command.run', { command: 'team-overview' }, async $ => {
    const cfg = await envoyConfig(makeIo($))
    if (!cfg) return { text: 'No team run in this session.' }
    // A pane that is open but not placed (a herdr pane under 144 columns) is not drawn, so it counts as closed.
    const open = (await $.ui.panes()).filter(p => p.isPlaced).map(p => p.id)
    if (open.includes(TEAM_PANE) || open.includes(QUESTIONS_PANE)) {
      await $.ui.close({ id: TEAM_PANE })
      await $.ui.close({ id: QUESTIONS_PANE })
      await $.store.set(hiddenKey(cfg.team_id), true)
      return { text: 'Team overview hidden.' }
    }
    await $.store.set(hiddenKey(cfg.team_id), false)
    await openPanes($)
    return { text: 'Team overview shown.' }
  })

  // The tabs open on the next tick, which finds the envoy role new to this session.
  on('command.run', { command: 'team-envoy' }, async $ => {
    const text = await reattach(makeIo($))
    return { text }
  })

  on('ui.close', { id: TEAM_PANE }, async ($, e, next) => {
    const done = await next(e)
    if (closeHides(e.origin)) await hideForRun($)
    return done
  })

  on('ui.close', { id: QUESTIONS_PANE }, async ($, e, next) => {
    const done = await next(e)
    if (closeHides(e.origin)) await hideForRun($)
    return done
  })

  on('ui.render', { component: 'Pane', requestId: QUESTIONS_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const current = await read($, cards)
    const open = await read($, expanded)
    const live = pruneExpanded(open, current)
    if (live !== open) await update($, expanded, () => live)
    return drawQuestions({ Box, Text, Button } as never, {
      cards: current,
      teamId: (await envoyConfig(makeIo($)))?.team_id ?? '',
      expanded: live,
      columns: e.props.bodyColumns,
      toggle: id => update($, expanded, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])),
    })
  })

  on('ui.render', { component: 'Pane', requestId: TEAM_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return drawPane({ Box, Text, Button } as never, {
      agents: await read($, agents),
      idle: await read($, idle),
      plan: await read($, plan),
      cards: await read($, cards),
      teamId: (await envoyConfig(makeIo($)))?.team_id ?? '',
      planPath: await read($, planPath),
      tickAt: await read($, tickAt),
      error: await read($, error),
      rows: e.viewport?.rows ?? 30,
    }, async a => {
      const reason = await herdrFocus(makeIo($), a.pane)
      if (reason !== '') await update($, error, () => `focus ${a.name}: ${reason}`)
    })
  })
}
