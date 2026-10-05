import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { TeamAgentRow, TeamPlan } from '../../types'
import { activeConfig, followClear, noteClear } from './activation'
import { BRIEF_TOOL, BRIEF_TOOL_SPEC, briefSend } from './brief'
import type { Io } from './io'
import { herdrAgents } from './herdr'
import { drawPane, hiddenKey, PANE } from './pane'
import { runDir, setCwd, teamDir } from './paths'
import { parsePlan } from './plan'
import { agentRows, newReportLines, readRecords, watchTick } from './tick'

export const TICK_MS = 15000
const active = atom({ plugin: 'team', key: 'active' } as const, false)
const agents = atom({ plugin: 'team', key: 'agents' } as const, [] as TeamAgentRow[])
const plan = atom({ plugin: 'team', key: 'plan' } as const, null as TeamPlan | null)
const planPath = atom({ plugin: 'team', key: 'planPath' } as const, '')
const tickAt = atom({ plugin: 'team', key: 'tickAt' } as const, '')
const error = atom({ plugin: 'team', key: 'error' } as const, '')

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
    sendTo: async (sessionId, text) => {
      const sent = await $.session.send({ to: { sessionId }, text })
      return sent.isDelivered ? { isDelivered: true } : { isDelivered: false, reason: sent.reason }
    },
    pluginRoot: $.plugin.root,
  }
}

async function showPane($: EngineInterface, teamId: string): Promise<void> {
  if ((await $.store.get(hiddenKey(teamId))) === true) return
  await $.ui.open({ id: PANE, title: 'Team' })
}

async function tick($: EngineInterface, io: Io): Promise<void> {
  await followClear(io)
  const cfg = await activeConfig(io)
  const was = await read($, active)
  await update($, active, () => cfg !== null)
  if (!cfg) return
  if (!was) await showPane($, cfg.team_id)
  const path = `${await runDir(io)}/progress-${cfg.ticket}.md`
  const text = await io.readText(path)
  await update($, planPath, () => path)
  await update($, plan, () => (text === null ? null : parsePlan(text)))

  const teamdir = await teamDir(io)
  const listed = await herdrAgents(io)
  const records = await readRecords(io, teamdir)
  const rows = await agentRows(io, teamdir, records, listed)
  await update($, agents, () => rows)
  await update($, error, () => (listed.ok ? '' : `herdr: ${listed.reason}`))

  const run = await runDir(io)
  const now = await $.clock.now()
  const watch = await watchTick(io, run, teamdir, records, listed, now, await $.session.id())
  const reports = await newReportLines(io, run, teamdir, records)
  const lines = [...reports.lines, ...watch]
  try {
    if (lines.length > 0) await $.prompt.submit({ text: lines.join('\n') })
    await reports.commit()
  } catch (err) {
    await update($, error, () => `prompt not sent: ${String(err).slice(0, 160)}`)
  }

  const at = new Date(await $.clock.now()).toISOString().slice(11, 19)
  await update($, tickAt, () => at)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    setCwd(e.cwd)
    const io = makeIo($)
    await $.env.set('TEAM_SESSION_ID', await $.session.id())
    await $.command.register({ name: 'team-overview', description: 'Show or hide the team overview pane' })
    await $.tool.register(BRIEF_TOOL_SPEC)
    $.clock.every(TICK_MS, () => tick($, io))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') noteClear(e.sessionId)
    return next(e)
  })

  on('tool.call', { tool: `mcp__team__${BRIEF_TOOL}` }, async ($, e) =>
    briefSend(makeIo($), String(e.name ?? ''), String(e.topic ?? '')))

  on('command.run', { command: 'team-overview' }, async $ => {
    const cfg = await activeConfig(makeIo($))
    if (!cfg) return { text: 'No team run in this session.' }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      await $.store.set(hiddenKey(cfg.team_id), true)
      return { text: 'Team overview hidden.' }
    }
    await $.store.set(hiddenKey(cfg.team_id), false)
    await $.ui.open({ id: PANE, title: 'Team' })
    return { text: 'Team overview shown.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const done = await next(e)
    if (e.origin.kind === 'person') {
      const cfg = await activeConfig(makeIo($))
      if (cfg) await $.store.set(hiddenKey(cfg.team_id), true)
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return drawPane({ Box, Text } as never, {
      agents: await read($, agents),
      plan: await read($, plan),
      planPath: await read($, planPath),
      tickAt: await read($, tickAt),
      error: await read($, error),
      rows: e.viewport?.rows ?? 30,
    })
  })
}
