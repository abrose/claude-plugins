import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { EddyBranchMode, EddyNewsHold, TeamAgentRow, TeamCard, TeamPlan } from '../../types'
import { activeConfig, envoyConfig, noteClear, sessionRole } from './activation'
import type { TeamConfig } from './activation'
import { badgeText, freshStall, freshUrgent, pickStatus, stallIds, TOAST_MS, toastText } from './badge'
import { paneDecideGuard, paneDropPrompt, paneFill, paneOnTurnComplete } from './branch-pane'
import {
  BRANCH_CLOSE_SPEC, BRANCH_MODE_SPEC, BRANCH_NOTE_SPEC, BRANCH_OPEN_SPEC, BRANCH_SETTLE_SPEC, branchCloseTool,
  branchModeTool, branchNoteTool, branchOpenTool, branchSettleTool, branchStatus, openBranch,
} from './branches'
import { BRIEF_TOOL, BRIEF_TOOL_SPEC, briefSend } from './brief'
import { denyText, eddyActive, teamToolCalls } from './coexist'
import { logReceived } from './inbox'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { bySession, herdrAgents, herdrFocus } from './herdr'
import type { HerdrListing } from './herdr'
import { newsHolds } from './holds'
import { closeHides, drawPane, drawQuestions, hiddenKey, pruneExpanded, QUESTIONS_PANE, EDDY_PANE } from './pane'
import { mainCheckout, runDir, teamDir } from './paths'
import { parsePlan } from './plan'
import { pluginVersion } from './version'
import { DECIDE_TOOL_SPEC, decideTool, QUEUE_TOOL_SPEC, queueTool } from './decide'
import { recordDenial } from './denial'
import { gatherInput, markShown, noteTurnEnd, noteTurnStart, pushNextAction, resetNextAction } from './next-action-push'
import { closeStalePromptCards } from './prompt-cards'
import { resetHolds } from './prompt-hold'
import { ASK_TOOL_SPEC, askTool, readCards } from './questions'
import { reattach } from './reattach'
import { RELAY_TOOL_SPEC, relayTool } from './relay'
import { pickDecisions } from './decisions'
import { numberMark } from './reports'
import {
  clearResetState, compactWhenIdle, noteMainTurn, nudgeLines, onCompacted, RESET_TOOL, RESET_TOOL_SPEC, RESUME_LINE,
  resetSelf, withHandoverInstructions,
} from './reset'
import type { ResetPort } from './reset'
import {
  agentRows, idleTabRows, newReportLines, readLedger, readRecords, stallWorkers, syncPanes, watchTick,
} from './tick'
import type { TeamRecord } from './tick'

export const TICK_MS = 15000
const active = atom({ plugin: 'eddy', key: 'active' } as const, false)
const agents = atom({ plugin: 'eddy', key: 'agents' } as const, [] as TeamAgentRow[])
const idle = atom({ plugin: 'eddy', key: 'idleTabs' } as const, [] as string[])
const plan = atom({ plugin: 'eddy', key: 'plan' } as const, null as TeamPlan | null)
const cards = atom({ plugin: 'eddy', key: 'cards' } as const, [] as TeamCard[])
const expanded = atom({ plugin: 'eddy', key: 'expandedCards' } as const, [] as string[])
const urgent = atom({ plugin: 'eddy', key: 'urgent' } as const, 0)
const planPath = atom({ plugin: 'eddy', key: 'planPath' } as const, '')
const tickAt = atom({ plugin: 'eddy', key: 'tickAt' } as const, '')
const version = atom({ plugin: 'eddy', key: 'version' } as const, '')
const error = atom({ plugin: 'eddy', key: 'error' } as const, '')
const branch = atom({ plugin: 'eddy', key: 'branch' } as const, null as { id: string; card: string; mode: EddyBranchMode } | null)
const holds = atom({ plugin: 'eddy', key: 'holds' } as const, { list: [], waiting: 0 } as { list: EddyNewsHold[]; waiting: number })
// One tick loop per module: a second session.start replaces it, never adds one.
let tickTimer: Timer | null = null
// True while a tick runs: a tick that finds it set returns at once.
let ticking = false
// Lines of a rejected send, in order. The next tick that sends puts them first. Memory only: a mod restart
// loses them. A new session.start (a /clear) keeps them.
let retryLines: string[] = []
// Sends that were called and have not settled: a submit waits while the session is busy. A requested
// compact waits for zero, so it never runs over a line that is queued but not yet taken.
let sendsInFlight = 0
// The status text this module set last; null until a session sets one, so its first tick always sets the line.
let lastBadge: string | undefined | null = null
// The three claimants of the status line as the last tick saw them, and how many news items the last push held
// back. The push runs after the status is set, so a changed count sets the line once more.
let claims: { notSent: string | undefined; urgent: string | undefined; stall: string | undefined } | null = null
let heldWaiting = 0

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
  // the cwd the engine inherits. An absolute EDDY_SCRATCH needs no git (see main-checkout.test.ts):
  // it passes the env alone and leaves the cwd to the engine.
  // Shared by io.run and io.rename; it reads `io` only when called, after io exists.
  const run: Io['run'] = async (argv, timeoutMs = 10000) => {
    try {
      const scratch = await $.env.get('EDDY_SCRATCH')
      if (scratch?.startsWith('/')) return await $.process.run(argv, { env: { EDDY_SCRATCH: scratch }, timeoutMs })
      const cwd = await projectRoot($)
      const env = { EDDY_SCRATCH: await runDir(io) }
      return await $.process.run(argv, { cwd, env, timeoutMs })
    } catch (err) {
      return { exitCode: -1, stdout: '', stderr: String(err) }
    }
  }
  const io: Io = {
    sessionId: () => $.session.id(),
    root: () => projectRoot($),
    envGet: async name =>
      name === 'EDDY_SCRATCH' ? $.env.get('EDDY_SCRATCH') : $.env.get('HERDR_BIN_PATH'),
    setSessionEnv: id => $.env.set('EDDY_SESSION_ID', id),
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
    submit: text => $.prompt.submit({ text }),
    draft: async () => {
      try {
        return (await $.prompt.read()).text
      } catch {
        return ''
      }
    },
    messages: async () => {
      try {
        return await $.session.messages()
      } catch {
        return []
      }
    },
    pluginRoot: $.plugin.root,
  }
  return io
}

// Both tabs open on the first activation and on show; the last one opened is the one shown.
async function openPanes($: EngineInterface): Promise<void> {
  await $.ui.open({ id: EDDY_PANE, title: 'Eddy' })
  await $.ui.open({ id: QUESTIONS_PANE, title: 'Eddy questions' })
}

// A person's close of either tab closes the other one too and stores hidden:
// the choice is per run, not per tab.
async function hideForRun($: EngineInterface): Promise<void> {
  const cfg = await envoyConfig(makeIo($))
  if (!cfg) return
  await $.store.set(hiddenKey(cfg.team_id), true)
  const open = (await $.ui.panes()).map(p => p.id)
  for (const id of [EDDY_PANE, QUESTIONS_PANE]) if (open.includes(id)) await $.ui.close({ id })
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
  const filed = await readCards(io, teamdir)
  // A card still waiting for the human (open, or parked and so assumed) holds its sender's release back.
  const waiting = new Set(filed.filter(c => c.status === 'open' || c.status === 'assumed').map(c => c.from))
  // The cards the eddy mod closed by itself: each gets one WATCH line, so the orchestrator flips its `[?]` step.
  const modClosed = filed.filter(c => c.status === 'obsolete' && c.closed_by === 'eddy mod')
  // A delivered.json that cannot be used holds REPORT and DECISION lines only. The watch rules, the layout
  // hygiene and the release run anyway: they have no use for the marks, and a person must see the outage.
  const reports = await newReportLines(io, run, teamdir, records)
  const watch = await watchTick(io, run, teamdir, records, listed, now, await $.session.id(), exemptTabs(cfg), waiting,
    { broken: reports.unreadable, path: reports.path }, modClosed)
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
  // The context nudge goes through the same send path as the other lines, so a rejected send keeps it.
  fresh = [...fresh, ...(await nudgeLines(resetPort($)))]
  // Lines of a rejected send go first. The list is emptied as the submit is called, so a later tick cannot send them twice.
  const lines = [...retryLines, ...fresh.filter(l => !retryLines.includes(l))]
  if (lines.length > 0) {
    retryLines = []
    // Not awaited: the tick ends here, and the submit settles whenever the session takes the prompt.
    void sendLines($, lines, split, failure !== null).catch(err => showNotSentSafely($, err, split))
  }
  // After the send, so a tick that sends lines sees the send in flight and compacts on a later one.
  // Not awaited either: a compact takes a model call, and a tick must not hold the next ticks back for it.
  void compactWhenIdle(resetPort($), { retryLines: retryLines.length, sendsInFlight }, text => update($, error, () => text),
    // No turn follows an idle-time compact by itself, so one RESUME line starts it. It goes through `sendLines`:
    // a rejected send lands in `retryLines` like any other line. Only this call sends it; the compact hook does not.
    () => { void sendLines($, [RESUME_LINE], split).catch(err => showNotSentSafely($, err, split)) },
  ).catch(() => {})
}

/** The two engine calls the reset needs, over `$`. The breakdown carries `autoCompactThreshold`. */
function resetPort($: EngineInterface): ResetPort {
  return {
    figures: async () => {
      // The plain call has no threshold; the summary breakdown is a local estimate, no request is made.
      const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => $.session.usage())
      const { tokens, window, breakdown } = usage.context
      // `rawMaxTokens` is the window /context measures against; `context.percent` is against the model window.
      return { tokens, window, compactWindow: breakdown?.rawMaxTokens, autoCompactThreshold: breakdown?.autoCompactThreshold }
    },
    compact: async instructions => {
      const done = await $.session.compact({ instructions })
      return done.skip === undefined ? {} : { skip: done.skip }
    },
  }
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
  sendsInFlight += 1
  try {
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
  } finally {
    sendsInFlight -= 1
  }
}

/** Test-only access to the module state; the mod itself never calls it. */
export const testing = {
  reset: () => {
    retryLines = []
    sendsInFlight = 0
    ticking = false
    lastBadge = null
    claims = null
    heldWaiting = 0
    clearResetState()
  },
  retryLines: () => [...retryLines],
  setBadge: (text: string | undefined | null) => {
    lastBadge = text
  },
  sendLines,
}

/**
 * The envoy half: the plan, the cards and the agent rows the panes draw, then the next-action message.
 * `canPush` is false in a session that also holds the orchestrator role: rule 16 forbids the orchestrator
 * to speak to the human, so such a session gets no next-action turn.
 */
async function envoyHalf(
  $: EngineInterface, io: Io, cfg: TeamConfig, teamdir: string,
  records: Record<string, TeamRecord>, listed: HerdrListing, canPush: boolean,
): Promise<void> {
  const run = await runDir(io)
  const path = `${run}/progress-${cfg.ticket}.md`
  const text = await io.readText(path)
  const parsed = text === null ? null : parsePlan(text)
  await update($, planPath, () => path)
  await update($, plan, () => parsed)
  const rows = agentRows(records, listed)
  // A card about a worker's permission prompt closes itself once the prompt is gone for two ticks in a row.
  // It runs before the `canPush` return: a single-session run closes such cards too.
  const stale = await closeStalePromptCards(io, {
    cards: await readCards(io, teamdir), records, rows, listed, now: await $.clock.now(),
  })
  const found = stale.cards
  await update($, cards, () => found)
  await update($, agents, () => rows)
  const myId = await $.session.id()
  const idleRows = await idleTabRows(io, await runDir(io), teamdir, records, listed, myId, exemptTabs(cfg))
  await update($, idle, () => idleRows.rows)
  await update($, error, () => (listed.ok ? '' : `herdr: ${listed.reason}`))
  // The orchestrator has a record, but its state comes from herdr's listing, by the session the config names.
  const orchestrator = listed.ok && cfg.orchestrator_session
    ? bySession(listed.agents).get(cfg.orchestrator_session)?.agent_status
    : undefined
  const stall = stallIds({
    cards: found,
    herdrUp: listed.ok,
    workers: stallWorkers(records, rows, idleRows.briefed, myId),
    orchestrator,
  })
  // An open branch marks its card in the Questions tab; every hold in force shows on the status line.
  const open = await openBranch(io, teamdir)
  await update($, branch, () => (open ? { id: open.id, card: open.card, mode: open.mode } : null))
  const held = await newsHolds(io)
  if (held.length === 0) heldWaiting = 0
  const stalled = await urgentBadge($, io, teamdir, found, stall, held)
  if (!canPush) {
    await update($, holds, () => ({ list: held, waiting: 0 }))
    return
  }
  await paneFill(io, text => $.prompt.fill({ text }).then(r => r.isFilled))
  const input = await gatherInput(io, {
    run, cfg, teamdir, records, rows, listed, cards: found, plan: parsed, stalled, myId,
    now: await $.clock.now(), dialogs: stale.dialogs, holds: held,
  })
  const waiting = await pushNextAction(io, teamdir, input)
  await update($, holds, () => ({ list: held, waiting }))
  if (waiting !== heldWaiting) {
    heldWaiting = waiting
    if (claims) await setStatus($, pickStatus(claims.notSent, claims.urgent, claims.stall, held.map(h => h.label), waiting))
  }
}

/**
 * The status line and the toasts; neither starts a turn. The line is, in this order: a `prompt not sent`
 * error (set only in an orchestrator-only session, and kept while it shows), the urgent badge, the stall
 * text. Each new urgent card gets one toast, and each stall episode one toast, whatever the line shows.
 * `stall` is `stallIds`: the open cards while the whole team waits on the human, else null.
 * Returns whether the run counts as stalled: the wait has held for `STALL_AFTER_MS`, the same timer that shows
 * the stall line and toast. The next-action trigger T4 reads this flag, not `stall` itself.
 */
async function urgentBadge(
  $: EngineInterface, io: Io, teamdir: string, found: TeamCard[], stall: string[] | null, held: EddyNewsHold[],
): Promise<boolean> {
  await update($, urgent, () => found.filter(c => c.urgent && (c.status === 'open' || c.status === 'assumed')).length)
  const marksPath = `${teamdir}/toasted.json`
  const read = await readJson<string[]>(io, marksPath)
  const fresh = freshUrgent(found, read)
  const waiting = freshStall(stall, found.some(c => c.status === 'open'), fresh.seen, await $.clock.now())
  const notSent = lastBadge?.startsWith(NOT_SENT) ? lastBadge : undefined
  claims = { notSent, urgent: badgeText(found), stall: waiting.text }
  await setStatus($, pickStatus(claims.notSent, claims.urgent, claims.stall, held.map(h => h.label), heldWaiting))
  for (const c of fresh.toast) await $.ui.toast(toastText(c), { timeoutMs: TOAST_MS })
  if (waiting.toast !== undefined) await $.ui.toast(waiting.toast, { timeoutMs: TOAST_MS })
  await writeJson(io, marksPath, waiting.seen)
  return waiting.text !== undefined
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
  if (role.envoy) await envoyHalf($, io, cfg, teamdir, records, listed, !role.orchestrator)
  if (role.orchestrator) await orchestratorHalf($, io, cfg, teamdir, records, listed, !role.envoy)

  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  await update($, tickAt, () => at)
}

export const register: Register = on => {
  mainRoot = null
  on('session.start', async ($, e, next) => {
    const io = makeIo($)
    await $.env.set('EDDY_SESSION_ID', await $.session.id())
    lastBadge = null
    claims = null
    heldWaiting = 0
    resetNextAction()
    resetHolds()
    clearResetState()
    // Read once: the footer shows the copy that runs, the one under the plugin root.
    const found = pluginVersion(await io.readText(`${io.pluginRoot}/.claude-plugin/plugin.json`))
    await update($, version, () => found ?? '')
    await $.command.register({ name: 'eddy-overview', description: 'Show or hide the Eddy and Eddy questions tabs' })
    await $.command.register({
      name: 'eddy-envoy',
      description: 'Make this session the envoy of the live eddy run; starts a new orchestrator if its session is gone',
    })
    await $.command.register({ name: 'eddy-branch', description: 'Show the open card branch' })
    await $.tool.register(BRANCH_OPEN_SPEC)
    await $.tool.register(BRANCH_NOTE_SPEC)
    await $.tool.register(BRANCH_MODE_SPEC)
    await $.tool.register(BRANCH_SETTLE_SPEC)
    await $.tool.register(BRANCH_CLOSE_SPEC)
    await $.tool.register(BRIEF_TOOL_SPEC)
    await $.tool.register(RESET_TOOL_SPEC)
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

  on('tool.call', { tool: `mcp__eddy__${BRIEF_TOOL}` }, async ($, e) =>
    briefSend(makeIo($), String(e.name ?? ''), String(e.topic ?? '')))

  // Only records the request: a tool call runs inside a turn, and a compact cannot. The tick compacts when idle.
  on('tool.call', { tool: `mcp__eddy__${RESET_TOOL}` }, async $ => resetSelf(makeIo($)))

  // Every compact of the orchestrator carries the handover instructions, Claude Code's own auto-compact too.
  // A subagent's compact (`agentId`) and a `precompute` (nothing installed) are left alone.
  on('session.compact', async ($, e, next) => {
    // An open branch lives in the envoy transcript: a compact the human or a plugin starts would lose its rows.
    // An auto compact passes, because a veto there could stall the envoy; a precompute installs nothing.
    if (e.agentId === undefined && (e.trigger === 'manual' || e.trigger === 'plugin')) {
      const io = makeIo($)
      const open = (await envoyConfig(io)) ? await openBranch(io, await teamDir(io)) : null
      if (open) return { skip: `An eddy branch is open (${open.id} on ${open.card}): settle it or drop it first.` }
    }
    if (e.agentId !== undefined || !(await activeConfig(makeIo($)))) return next(e)
    const done = await next({ ...e, instructions: withHandoverInstructions(e.instructions) })
    if (done.skip === undefined && e.trigger !== 'precompute') onCompacted()
    return done
  })

  // The orchestrator's inbox log: RELAY and peer lines leave no other trace. It never holds a delivery back.
  on('session.receive', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        const io = makeIo($)
        if (await activeConfig(io)) await logReceived(io, e.text)
      } catch {
        // A log that cannot be written must not stop the delivery.
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__eddy__ask' }, async ($, e) => askTool(makeIo($), e))

  // A queue call shows the cards to the envoy: the next-action message does not repeat what it just read.
  on('tool.call', { tool: 'mcp__eddy__queue' }, async ($, e) => {
    const io = makeIo($)
    const shown = await queueTool(io, e)
    if (!shown.isError) await markShown(io, await teamDir(io))
    return shown
  })

  // The envoy is mid-turn between these two events: a next-action message waits for the end.
  on('turn.start', async ($, e, next) => {
    noteTurnStart(await $.clock.now())
    noteMainTurn(true)
    return next(e)
  })

  // A subagent's turn ends with an `agentId`; only the main loop's end frees the envoy.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      noteTurnEnd()
      noteMainTurn(false)
      await paneOnTurnComplete(makeIo($))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const drop = await paneDropPrompt(makeIo($), e)
    return drop === null ? next(e) : { drop }
  })

  on('tool.call', { tool: 'mcp__eddy__decide' }, async ($, e) => {
    const io = makeIo($)
    return (await paneDecideGuard(io)) ?? decideTool(io, e)
  })

  on('tool.call', { tool: 'mcp__eddy__branch_open' }, async ($, e) => branchOpenTool(makeIo($), e))
  on('tool.call', { tool: 'mcp__eddy__branch_note' }, async ($, e) => branchNoteTool(makeIo($), e))
  on('tool.call', { tool: 'mcp__eddy__branch_mode' }, async ($, e) => branchModeTool(makeIo($), e))
  on('tool.call', { tool: 'mcp__eddy__branch_settle' }, async () => branchSettleTool())
  on('tool.call', { tool: 'mcp__eddy__branch_close' }, async ($, e) => branchCloseTool(makeIo($), e))

  on('tool.call', { tool: 'mcp__eddy__relay' }, async ($, e) => relayTool(makeIo($), e))

  // The team plugin registers its tools in every session. In an eddy session point the caller at the eddy tool.
  // No catch handler: a guard that throws lets the call go on, and the team plugin refuses a foreign caller itself.
  for (const { name, tool } of teamToolCalls) {
    on('tool.call', { tool }, async ($, e, next) =>
      (await eddyActive(makeIo($))) ? { deny: denyText(name) } : next(e))
  }

  // Auto mode denied a tool call: record it, and pass the event on unchanged (no `retry`).
  on('classic.PermissionDenied', async ($, e, next) => {
    await recordDenial(makeIo($), e.tool_name, e.reason)
    return next(e)
  })

  on('command.run', { command: 'eddy-overview' }, async $ => {
    const cfg = await envoyConfig(makeIo($))
    if (!cfg) return { text: 'No eddy run in this session.' }
    // A pane that is open but not placed (a herdr pane under 144 columns) is not drawn, so it counts as closed.
    const open = (await $.ui.panes()).filter(p => p.isPlaced).map(p => p.id)
    if (open.includes(EDDY_PANE) || open.includes(QUESTIONS_PANE)) {
      await $.ui.close({ id: EDDY_PANE })
      await $.ui.close({ id: QUESTIONS_PANE })
      await $.store.set(hiddenKey(cfg.team_id), true)
      return { text: 'Eddy overview hidden.' }
    }
    await $.store.set(hiddenKey(cfg.team_id), false)
    await openPanes($)
    return { text: 'Eddy overview shown.' }
  })

  on('command.run', { command: 'eddy-branch' }, async $ => ({ text: await branchStatus(makeIo($)) }))

  // The tabs open on the next tick, which finds the envoy role new to this session.
  on('command.run', { command: 'eddy-envoy' }, async $ => {
    const text = await reattach(makeIo($))
    return { text }
  })

  on('ui.close', { id: EDDY_PANE }, async ($, e, next) => {
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
      discussing: await read($, branch),
      toggle: id => update($, expanded, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])),
    })
  })

  on('ui.render', { component: 'Pane', requestId: EDDY_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return drawPane({ Box, Text, Button } as never, {
      agents: await read($, agents),
      idle: await read($, idle),
      plan: await read($, plan),
      cards: await read($, cards),
      teamId: (await envoyConfig(makeIo($)))?.team_id ?? '',
      planPath: await read($, planPath),
      tickAt: await read($, tickAt),
      version: await read($, version),
      error: await read($, error),
      rows: e.viewport?.rows ?? 30,
    }, async a => {
      const reason = await herdrFocus(makeIo($), a.pane)
      if (reason !== '') await update($, error, () => `focus ${a.name}: ${reason}`)
    })
  })
}
