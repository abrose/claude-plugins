import { describe, expect, test } from 'claude-code/testing'
import { layoutActions } from '../../hooks/mod/layout'
import { watchLines } from '../../hooks/mod/watch'
import { team } from './world'

const fact = (over: object) => ({
  name: 'a', state: 'working', pane: 'w1:p2', reportPath: '/r/a-t.md',
  hasFreshReport: false, quietSinceStop: false, ...over,
})
const empty = { agents: {}, _flagged: {}, _idle_since: {} }

describe('watchLines', () => {
  test('a turn to blocked is flagged with the old state', () => {
    const r = watchLines([fact({ state: 'blocked' })], { ...empty, agents: { a: 'working' } }, 0, 120)
    expect(r.blocked).toEqual(['a'])
    expect(r.lines).toEqual(['WATCH a: working -> blocked'])
  })
  test('idle without a fresh report is flagged once, after the grace period', () => {
    let r = watchLines([fact({ state: 'idle' })], empty, 1000, 120)
    expect(r.lines).toEqual([])
    r = watchLines([fact({ state: 'idle' })], r.mem, 1000 + 120_000, 120)
    expect(r.lines).toEqual(['WATCH a: idle, no report - read /r/a-t.md'])
    r = watchLines([fact({ state: 'idle' })], r.mem, 1000 + 240_000, 120)
    expect(r.lines).toEqual([])
  })
  test('quiet since its stop counts even while herdr shows working', () => {
    const r = watchLines([fact({ quietSinceStop: true })], empty, 0, 120)
    expect(r.lines).toEqual(['WATCH a: idle, no report - read /r/a-t.md'])
  })
  test('a fresh report is never flagged', () => {
    const r = watchLines([fact({ state: 'idle', hasFreshReport: true })], empty, 999_999, 120)
    expect(r.lines).toEqual([])
  })
})

describe('layoutActions', () => {
  const base = {
    teamTabs: ['w1:t2'], orchTabs: ['w1:t1'], namedPanes: new Set(['w1:p2', 'w1:p3']),
    pending: new Set<string>(), briefed: new Map<string, boolean>(), prevFlags: [] as string[],
  }
  test('never closes a pane team-start marked pending', () => {
    const r = layoutActions({ ...base, pending: new Set(['w1:p2']), panes: [
      { pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'unknown' },
    ] })
    expect(r.closes).toEqual([])
  })
  test('closes an empty pane a record names, never one it does not', () => {
    const r = layoutActions({ ...base, panes: [
      { pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'unknown' },
      { pane_id: 'w1:p9', tab_id: 'w1:t2', agent_status: 'unknown' },
    ] })
    expect(r.closes).toEqual(['w1:p2'])
  })
  test('never touches the orchestrator tab', () => {
    const r = layoutActions({ ...base, teamTabs: ['w1:t1'], panes: [
      { pane_id: 'w1:p2', tab_id: 'w1:t1', agent_status: 'unknown' },
    ] })
    expect(r.closes).toEqual([])
  })
  test('flags a tab over budget once', () => {
    const panes = Array.from({ length: 7 }, (_, i) => ({ pane_id: `w1:x${i}`, tab_id: 'w1:t2', agent_status: 'working' }))
    let r = layoutActions({ ...base, panes })
    expect(r.fresh).toEqual(['layout: tab w1:t2 over budget (7/6)'])
    r = layoutActions({ ...base, panes, prevFlags: r.flags })
    expect(r.fresh).toEqual([])
  })
  test('a never-briefed idle tab gets no release suggestion', () => {
    const panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    expect(layoutActions({ ...base, panes }).fresh).toEqual([])
  })
  test('suggests release only when every briefed agent there has a fresh report', () => {
    const panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    expect(layoutActions({ ...base, panes, briefed: new Map([['w1:p2', false]]) }).fresh).toEqual([])
    expect(layoutActions({ ...base, panes, briefed: new Map([['w1:p2', true]]) }).fresh)
      .toEqual(['layout: tab w1:t2 idle, consider release'])
  })
})

describe('quiet since the last stop', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const turn = (type: string, ms: number) => JSON.stringify({ type, timestamp: iso(ms) })
  const TR = '/proj/transcript.jsonl'

  async function stoppedWorker($: any, on: any) {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    w.write(TR, turn('assistant', 999_000) + '\n')
    w.writeJson(`${w.team}/stops/app-1-scout.json`, { transcript: TR, at: 1000 })
    return w
  }
  const flags = (w: any) => w.submits.filter((s: string) => s.includes('no report'))

  test('a worker herdr calls working is flagged once quiet past the grace period', async ($, on) => {
    const w = await stoppedWorker($, on)
    for (let i = 0; i < 9; i++) await w.clock.advance(15000)
    expect(flags(w)).toHaveLength(1)
  })

  test('is not flagged within the grace period', async ($, on) => {
    const w = await stoppedWorker($, on)
    await w.clock.advance(15000)
    expect(flags(w)).toEqual([])
  })

  test('a turn after the stop means it is busy again', async ($, on) => {
    const w = await stoppedWorker($, on)
    w.write(TR, turn('assistant', 999_000) + '\n' + turn('user', 1_001_000) + '\n')
    for (let i = 0; i < 9; i++) await w.clock.advance(15000)
    expect(flags(w)).toEqual([])
  })

  test('a brief newer than the stop belongs to a new task', async ($, on) => {
    const w = await stoppedWorker($, on)
    w.write(`${w.cwd}/scratchpad/current/brief-app-1-scout-.md`, '# Brief\n', 1_005_000)
    for (let i = 0; i < 9; i++) await w.clock.advance(15000)
    expect(flags(w)).toEqual([])
  })
})

describe('watch in the tick', () => {
  test('blocked line carries the dialog and goes out in the tick prompt', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['WATCH app-1-scout: working -> blocked: Allow Bash(rm -rf build)? [y/n]'])
  })

  test('herdr down sends one line until it is back', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.herdrFails = 'server_unavailable'
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['WATCH herdr unreachable: server_unavailable'])
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: 'herdr: server_unavailable' })).toBeDefined()
    w.herdrFails = null
    await w.clock.advance(15000)
    w.herdrFails = 'again'
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['WATCH herdr unreachable: server_unavailable', 'WATCH herdr unreachable: again'])
  })

  test('an idle worker without a report is flagged after the grace period', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    for (let i = 0; i < 9; i++) await w.clock.advance(15000)
    expect(w.submits).toEqual([
      'WATCH app-1-scout: idle, no report - read /proj/scratchpad/current/reports/app-1-scout-.md',
    ])
  })

  test('the orchestrator tab from the config gets no layout flags while herdr does not know the session', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), orchestrator_tab: 'w1:t1' })
    w.writeJson(`${w.team}/tabs.json`, ['w1:t1'])
    w.panes = Array.from({ length: 7 }, (_, i) => ({ pane_id: `w1:x${i}`, tab_id: 'w1:t1', agent_status: 'working' }))
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('layout'))).toEqual([])
  })

  test('a report file without a REPORT line still counts as no report', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, 'still waiting on two subagents\n')
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    for (let i = 0; i < 9; i++) await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('no report'))).toHaveLength(1)
  })

  test('a reported REPORT and a WATCH line of one tick share one prompt, REPORT first', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/app-1-maker.json`, { role: 'implementer', topic: 'build', brief: '', pane: 'w1:p3', session: 'sid-maker' })
    w.agents = [
      { pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } },
      { pane_id: 'w1:p3', agent_status: 'working', agent_session: { value: 'sid-maker' } },
    ]
    await w.clock.advance(15000)
    w.agents = [
      { pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } },
      { pane_id: 'w1:p3', agent_status: 'idle', agent_session: { value: 'sid-maker' } },
    ]
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-maker-build.md`, 'REPORT app-1-maker build: green\n')
    await w.clock.advance(15000)
    expect(w.submits).toEqual([
      'REPORT app-1-maker build: green\nWATCH app-1-scout: working -> blocked: Allow Bash(rm -rf build)? [y/n]',
    ])
  })
})
