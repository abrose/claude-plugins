import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { TeamAgentRow, TeamCard, TeamPlan } from '../../types'
import { envoyConfig, noteClear, sessionRole } from './activation'
import type { TeamConfig } from './activation'
import { badgeText, freshUrgent, toastText } from './badge'
import { BRIEF_TOOL, BRIEF_TOOL_SPEC, briefSend } from './brief'
import { readJson, writeJson } from './io'
import type { Io } from './io'
import { herdrAgents, herdrFocus } from './herdr'
import type { HerdrListing } from './herdr'
import { closeHides, drawPane, drawQuestions, hiddenKey, QUESTIONS_PANE, TEAM_PANE } from './pane'
import { runDir, setCwd, teamDir } from './paths'
import { parsePlan } from './plan'
import { DECIDE_TOOL_SPEC, decideTool, QUEUE_TOOL_SPEC, queueTool } from './decide'
import { ASK_TOOL_SPEC, askTool, readCards } from './questions'
import { RELAY_TOOL_SPEC, relayTool } from './relay'
import { pickDecisions } from './decisions'
import { agentRows, idleTabRows, newReportLines, readLedger, readRecords, syncPanes, watchTick } from './tick'
import type { TeamRecord } from './tick'

export const TICK_MS = 15000
const active = atom({ plugin: 'team', key: 'active' } as const, false)
const agents = atom({ plugin: 'team', key: 'agents' } as const, [] as TeamAgentRow[])
const idle = atom({ plugin: 'team', key: 'idleTabs' } as const, [] as string[])
const plan = atom({ plugin: 'team', key: 'plan' } as const, null as TeamPlan | null)
const cards = atom({ plugin: 'team', key: 'cards' } as const, [] as TeamCard[])
const urgent = atom({ plugin: 'team', key: 'urgent' } as const, 0)
const planPath = atom({ plugin: 'team', key: 'planPath' } as const, '')
const tickAt = atom({ plugin: 'team', key: 'tickAt' } as const, '')
const error = atom({ plugin: 'team', key: 'error' } as const, '')
// One tick loop per module: a second session.start replaces it, never adds one.
let tickTimer: Timer | null = null
// The status text this module set last; null until a session sets one, so its first tick always sets the line.
let lastBadge: string | undefined | null = null

function makeIo($: EngineInterface): Io {
  return {
    sessionId: () => $.session.id(),
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
    run: async (argv, timeoutMs = 10000) => {
      try {
        return await $.process.run(argv, { timeoutMs })
      } catch (err) {
        return { exitCode: -1, stdout: '', stderr: String(err) }
      }
    },
    sleep: ms => $.clock.sleep(ms),
    now: () => $.clock.now(),
    sendTo: async (sessionId, text) => {
      const sent = await $.session.send({ to: { sessionId }, text })
      return sent.isDelivered ? { isDelivered: true } : { isDelivered: false, reason: sent.reason }
    },
    pluginRoot: $.plugin.root,
  }
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
  const watch = await watchTick(io, run, teamdir, records, listed, now, await $.session.id(), exemptTabs(cfg), waiting)
  const reports = await newReportLines(io, run, teamdir, records)
  const decisions = pickDecisions(await readLedger(io, teamdir), reports.delivered._decision)
  const lines = [...reports.lines, ...decisions.lines, ...watch]
  try {
    if (lines.length > 0) await $.prompt.submit({ text: lines.join('\n') })
    await reports.commit({ _decision: decisions.mark })
    if (split && lines.length > 0 && lastBadge?.startsWith(NOT_SENT)) await setStatus($, undefined)
  } catch (err) {
    const text = `${NOT_SENT}${String(err).slice(0, 160)}`
    await update($, error, () => text)
    if (split) await setStatus($, text)
  }
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
  const idleRows = await idleTabRows(io, await runDir(io), teamdir, records, listed, await $.session.id(), exemptTabs(cfg))
  await update($, idle, () => idleRows)
  await update($, error, () => (listed.ok ? '' : `herdr: ${listed.reason}`))
  await urgentBadge($, io, teamdir, found)
}

/** The status line shows the urgent count; each new urgent card gets one toast. Neither starts a turn. */
async function urgentBadge($: EngineInterface, io: Io, teamdir: string, found: TeamCard[]): Promise<void> {
  const text = badgeText(found)
  await update($, urgent, () => found.filter(c => c.urgent && (c.status === 'open' || c.status === 'assumed')).length)
  await setStatus($, text)
  const marksPath = `${teamdir}/toasted.json`
  const fresh = freshUrgent(found, await readJson<string[]>(io, marksPath))
  for (const c of fresh.toast) await $.ui.toast(toastText(c))
  await writeJson(io, marksPath, fresh.seen)
}

async function tick($: EngineInterface, io: Io): Promise<void> {
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
  on('session.start', async ($, e, next) => {
    setCwd(e.cwd)
    const io = makeIo($)
    await $.env.set('TEAM_SESSION_ID', await $.session.id())
    lastBadge = null
    await $.command.register({ name: 'team-overview', description: 'Show or hide the Team and Questions tabs' })
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
    const { Box, Text } = $.ui.resolve(e)
    return drawQuestions({ Box, Text } as never, await read($, cards))
  })

  on('ui.render', { component: 'Pane', requestId: TEAM_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return drawPane({ Box, Text, Button } as never, {
      agents: await read($, agents),
      idle: await read($, idle),
      plan: await read($, plan),
      cards: await read($, cards),
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
