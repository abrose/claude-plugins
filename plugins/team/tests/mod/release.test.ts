import { describe, expect, test } from 'claude-code/testing'
import { RELEASE_AFTER_MIN, releaseDue } from '../../hooks/mod/release'
import { watchLines } from '../../hooks/mod/watch'
import { card, envoyTeam, team } from './world'
import type { World } from './world'

const MIN = 60_000
const fact = (over: object) => ({
  name: 'a', state: 'idle', pane: 'w1:p2', reportPath: '/r/a-t.md',
  hasFreshReport: true, quietSinceStop: false, ...over,
})
const empty = { agents: {}, _flagged: {}, _idle_since: {} }

describe('the release timer in watchLines', () => {
  test('starts at the first tick of idle with a fresh report and keeps its start', () => {
    let r = watchLines([fact({})], empty, 5000, 120)
    expect(r.mem._release_since).toEqual({ a: 5000 })
    r = watchLines([fact({})], r.mem, 99_000, 120)
    expect(r.mem._release_since).toEqual({ a: 5000 })
  })

  test('done counts like idle', () => {
    const r = watchLines([fact({ state: 'done' })], empty, 5000, 120)
    expect(r.mem._release_since).toEqual({ a: 5000 })
  })

  test('working resets the timer', () => {
    let r = watchLines([fact({})], empty, 5000, 120)
    r = watchLines([fact({ state: 'working' })], r.mem, 6000, 120)
    expect(r.mem._release_since).toEqual({})
    r = watchLines([fact({})], r.mem, 7000, 120)
    expect(r.mem._release_since).toEqual({ a: 7000 })
  })

  test('blocked resets the timer', () => {
    let r = watchLines([fact({})], empty, 5000, 120)
    r = watchLines([fact({ state: 'blocked' })], r.mem, 6000, 120)
    expect(r.mem._release_since).toEqual({})
  })

  test('no timer without a fresh REPORT', () => {
    const r = watchLines([fact({ hasFreshReport: false })], { ...empty, _release_since: { a: 1000 } }, 5000, 120)
    expect(r.mem._release_since).toEqual({})
  })

  test('an agent that left the list loses its timer', () => {
    const r = watchLines([], { ...empty, _release_since: { a: 1000 }, _release_tried: { a: true } }, 5000, 120)
    expect(r.mem._release_since).toEqual({})
    expect(r.mem._release_tried).toEqual({})
  })

  test('a release already tried is remembered while the agent stays quiet, and forgotten when it works', () => {
    const mem = { ...empty, _release_since: { a: 1000 }, _release_tried: { a: true } }
    let r = watchLines([fact({})], mem, 5000, 120)
    expect(r.mem._release_tried).toEqual({ a: true })
    r = watchLines([fact({ state: 'working' })], r.mem, 6000, 120)
    expect(r.mem._release_tried).toEqual({})
  })
})

describe('releaseDue', () => {
  const input = {
    facts: [fact({})],
    since: { a: 0 },
    tried: {},
    paneTab: new Map([['w1:p2', 'w1:t2']]),
    teamTabs: ['w1:t2'],
    orchTabs: ['w1:t1'],
    openCards: new Set<string>(),
    now: 30 * MIN,
  }

  test('the limit is 30 minutes, one named constant', () => {
    expect(RELEASE_AFTER_MIN).toBe(30)
  })

  test('is due at exactly 30 minutes and not one millisecond before', () => {
    expect(releaseDue(input)).toEqual(['a'])
    expect(releaseDue({ ...input, now: 30 * MIN - 1 })).toEqual([])
  })

  test('an open or assumed card of that agent holds it back; an answered one and a card of another agent do not', () => {
    expect(releaseDue({ ...input, openCards: new Set(['a']) })).toEqual([])
    expect(releaseDue({ ...input, openCards: new Set(['b']) })).toEqual(['a'])
  })

  test('a pane in an exempt tab is never due', () => {
    expect(releaseDue({ ...input, orchTabs: ['w1:t2'] })).toEqual([])
  })

  test('a pane whose tab is unknown is never due', () => {
    expect(releaseDue({ ...input, paneTab: new Map() })).toEqual([])
  })

  test('a pane in a tab that is not a team tab is never due', () => {
    expect(releaseDue({ ...input, teamTabs: [] })).toEqual([])
    expect(releaseDue({ ...input, teamTabs: ['w1:t9'] })).toEqual([])
  })

  test('an agent without a timer is never due', () => {
    expect(releaseDue({ ...input, since: {} })).toEqual([])
  })

  test('a release already tried is not due again', () => {
    expect(releaseDue({ ...input, tried: { a: true } })).toEqual([])
  })
})

describe('auto-release in the tick', () => {
  const REPORT = 'REPORT app-1-scout x: done\n'
  const sub = (argv: string[]) => argv.slice(1).join(' ')
  const herdrCalls = (w: World) => w.runs.map(sub).filter(s => /^(agent prompt|pane close)/.test(s))
  const forgets = (w: World) => w.runs.filter(argv => (argv[0] ?? '').endsWith('/bin/team-forget'))
  const notices = (w: World) => w.submits.flatMap(s => s.split('\n')).filter(l => !l.startsWith('REPORT'))

  /** A reported, idle worker whose timer started `idleMs` before the first tick. */
  async function idleWorker($: any, on: any, idleMs = 30 * MIN) {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, REPORT, 1000)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    w.writeJson(`${w.team}/tabs.json`, ['w1:t2'])
    const first = w.clock.now() + 15_000
    w.writeJson(`${w.team}/watch-state.json`, {
      agents: { 'app-1-scout': 'idle' }, _flagged: {}, _idle_since: {}, _release_since: { 'app-1-scout': first - idleMs },
    })
    return w
  }

  test('after 30 minutes idle it clears, closes the pane, forgets the agent and tells the orchestrator once', async ($, on) => {
    const w = await idleWorker($, on)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual(['agent prompt w1:p2 /clear --wait', 'pane close w1:p2'])
    expect(forgets(w).map(argv => argv.slice(1))).toEqual([['app-1-scout']])
    expect(w.files.has(`${w.team}/app-1-scout.json`)).toBe(false)
    expect(notices(w)).toEqual(['released app-1-scout (w1:p2) after 30 min idle'])
    await w.clock.advance(15000)
    expect(notices(w)).toEqual(['released app-1-scout (w1:p2) after 30 min idle'])
    expect(herdrCalls(w)).toHaveLength(2)
  })

  test('one millisecond short of 30 minutes releases nothing', async ($, on) => {
    const w = await idleWorker($, on, 30 * MIN - 1)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
    expect(notices(w)).toEqual([])
  })

  test('the timer starts at the first idle tick and the release comes 30 minutes later', async ($, on) => {
    const w = await idleWorker($, on)
    w.files.delete(`${w.team}/watch-state.json`)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
    await w.clock.advance(30 * MIN - 15000)
    expect(herdrCalls(w)).toEqual([])
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual(['agent prompt w1:p2 /clear --wait', 'pane close w1:p2'])
  })

  test('working in between resets the timer', async ($, on) => {
    const w = await idleWorker($, on, 29 * MIN)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(2 * MIN)
    expect(herdrCalls(w)).toEqual([])
    expect(w.json(`${w.team}/watch-state.json`)._release_since['app-1-scout']).toBeGreaterThan(w.clock.now() - 2 * MIN - 15000)
  })

  test('blocked in between resets the timer', async ($, on) => {
    const w = await idleWorker($, on, 29 * MIN)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(2 * MIN)
    expect(herdrCalls(w)).toEqual([])
  })

  test('an agent without a REPORT is never released', async ($, on) => {
    const w = await idleWorker($, on)
    w.files.delete(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`)
    await w.clock.advance(15000)
    await w.clock.advance(45 * MIN)
    expect(herdrCalls(w)).toEqual([])
    expect(notices(w).some(l => l.startsWith('released'))).toBe(false)
  })

  test('a report older than the brief does not count', async ($, on) => {
    const w = await idleWorker($, on)
    w.write(`${w.cwd}/scratchpad/current/brief-app-1-scout-.md`, '# Brief\n', 5000)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('an open card of that agent holds the release back; once it is answered the release goes', async ($, on) => {
    const w = await idleWorker($, on)
    card(w, 1, { from: 'app-1-scout' })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
    card(w, 1, { from: 'app-1-scout', status: 'answered', decision: 2 })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual(['agent prompt w1:p2 /clear --wait', 'pane close w1:p2'])
  })

  test('a parked (assumed) card also holds the release back', async ($, on) => {
    const w = await idleWorker($, on)
    card(w, 1, { from: 'app-1-scout', status: 'assumed' })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('the card of another agent does not hold it back', async ($, on) => {
    const w = await idleWorker($, on)
    card(w, 1, { from: 'app-1-tester' })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toHaveLength(2)
  })

  test('a pane in the orchestrator tab is never released', async ($, on) => {
    const w = await idleWorker($, on)
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), orchestrator_tab: 'w1:t2' })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('a pane in the envoy tab is never released', async ($, on) => {
    const w = await idleWorker($, on)
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), envoy_tab: 'w1:t2' })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('a pane in a tab that is not a team tab (not in tabs.json) is never released', async ($, on) => {
    const w = await idleWorker($, on)
    w.writeJson(`${w.team}/tabs.json`, ['w1:t7'])
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
    expect(forgets(w)).toEqual([])
    expect(notices(w)).toEqual([])
    w.files.delete(`${w.team}/tabs.json`)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('a worker record that carries the mod\'s own session id is never released', async ($, on) => {
    const w = await idleWorker($, on)
    // No tab_id on the agent: the own tab is then not in the exempt list, so only the own-session guard holds.
    w.writeJson(`${w.team}/app-1-me.json`, { role: 'implementer', topic: '', brief: '', pane: 'w1:p3', session: w.id })
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-me-.md`, REPORT, 1000)
    w.agents = [{ pane_id: 'w1:p3', agent_status: 'idle', agent_session: { value: w.id } }]
    w.panes = [{ pane_id: 'w1:p3', tab_id: 'w1:t3', agent_status: 'idle' }]
    w.writeJson(`${w.team}/tabs.json`, ['w1:t3'])
    w.writeJson(`${w.team}/watch-state.json`, {
      agents: {}, _flagged: {}, _idle_since: {}, _release_since: { 'app-1-me': -99 * MIN },
    })
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
    expect(forgets(w)).toEqual([])
    expect(w.files.has(`${w.team}/app-1-me.json`)).toBe(true)
    expect(notices(w)).toEqual([])
  })

  test('the envoy session releases nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, REPORT, 1000)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    w.writeJson(`${w.team}/tabs.json`, ['w1:t2'])
    w.writeJson(`${w.team}/watch-state.json`, { agents: {}, _flagged: {}, _idle_since: {}, _release_since: { 'app-1-scout': -99 * MIN } })
    await w.clock.advance(15000)
    expect(herdrCalls(w)).toEqual([])
  })

  test('herdr going down drops the timers', async ($, on) => {
    const w = await idleWorker($, on)
    w.herdrFails = 'server_unavailable'
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/watch-state.json`)._release_since).toEqual({})
    expect(herdrCalls(w)).toEqual([])
  })

  describe('a failed step', () => {
    const line = (step: string, reason: string) => `WATCH app-1-scout: auto-release failed at ${step}: ${reason}`

    test('/clear failing stops the release: the pane stays and a WATCH line names the step', async ($, on) => {
      const w = await idleWorker($, on)
      w.fails.set('agent prompt', 'pane not found')
      await w.clock.advance(15000)
      expect(herdrCalls(w)).toEqual(['agent prompt w1:p2 /clear --wait'])
      expect(forgets(w)).toEqual([])
      expect(w.files.has(`${w.team}/app-1-scout.json`)).toBe(true)
      expect(notices(w)).toEqual([line('clear', 'pane not found')])
    })

    test('closing the pane failing stops the release before the record goes', async ($, on) => {
      const w = await idleWorker($, on)
      w.fails.set('pane close', 'pane busy')
      await w.clock.advance(15000)
      expect(forgets(w)).toEqual([])
      expect(w.files.has(`${w.team}/app-1-scout.json`)).toBe(true)
      expect(notices(w)).toEqual([line('close pane', 'pane busy')])
    })

    test('team-forget refusing raises a WATCH line and sends no release notice', async ($, on) => {
      const w = await idleWorker($, on)
      w.fails.set('team-forget', 'cannot delete the index entry')
      await w.clock.advance(15000)
      expect(notices(w)).toEqual([line('team-forget', 'cannot delete the index entry')])
    })

    test('it is never retried in a loop: no second attempt, no second line', async ($, on) => {
      const w = await idleWorker($, on)
      w.fails.set('pane close', 'pane busy')
      for (let i = 0; i < 6; i++) await w.clock.advance(15000)
      expect(herdrCalls(w).filter(c => c.startsWith('agent prompt'))).toHaveLength(1)
      expect(notices(w)).toHaveLength(1)
    })

    test('an agent that worked and went quiet again is tried afresh', async ($, on) => {
      const w = await idleWorker($, on)
      w.fails.set('pane close', 'pane busy')
      await w.clock.advance(15000)
      w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
      await w.clock.advance(15000)
      expect(w.json(`${w.team}/watch-state.json`)._release_tried).toEqual({})
    })
  })
})
