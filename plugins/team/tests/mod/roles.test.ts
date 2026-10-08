import { describe, expect, test } from 'claude-code/testing'
import { roleOf } from '../../hooks/mod/activation'
import { call, card, envoyTeam, team } from './world'

const report = (line: string) => `# Report\n\n---\n\n${line}\n`
const HEAD = '# Decisions APP-1\nNumbered, dated, one paragraph each.\n'

describe('roleOf', () => {
  const cfg = { team_id: 'a', ticket: 'A', orchestrator: 'a-orch', orchestrator_session: 'o', envoy_session: 'e' }
  test('names each half', () => {
    expect(roleOf(cfg, 'o')).toEqual({ orchestrator: true, envoy: false })
    expect(roleOf(cfg, 'e')).toEqual({ orchestrator: false, envoy: true })
    expect(roleOf(cfg, 'x')).toEqual({ orchestrator: false, envoy: false })
  })
  test('without envoy_session the orchestrator holds both', () => {
    expect(roleOf({ ...cfg, envoy_session: undefined }, 'o')).toEqual({ orchestrator: true, envoy: true })
  })
})

describe('the two halves', () => {
  test('the envoy session draws and never submits', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
    expect(w.submits).toEqual([])
  })

  test('the orchestrator session submits and never draws', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
  })

  test('a team dir without envoy_session runs both halves in the orchestrator', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
  })

  test('the orchestrator record is neither watched nor reported', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.writeJson(`${w.team}/app-1-orch.json`, { role: 'orchestrator', topic: '', brief: 'b', pane: 'w1:p9', session: 'sid-orch-worker' })
    w.agents = [{ pane_id: 'w1:p9', tab_id: 'w1:t9', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }]
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-orch-.md`, report('REPORT app-1-orch x: y'))
    await w.clock.advance(15000)
    await w.clock.advance(150000)
    expect(w.submits.join('\n')).not.toContain('app-1-orch')
  })

  test('the envoy tab is exempt from layout hygiene', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    const cfg = w.json(`${w.team}/config.json`)
    w.writeJson(`${w.team}/config.json`, { ...cfg, envoy_tab: 'w1:t5' })
    w.writeJson(`${w.team}/tabs.json`, ['w1:t5'])
    w.writeJson(`${w.team}/app-1-gone.json`, { role: 'tester', topic: '', brief: '', pane: 'w1:p50', session: 'sid-gone' })
    w.panes = [{ pane_id: 'w1:p50', tab_id: 'w1:t5', agent_status: 'none' }]
    await w.clock.advance(15000)
    expect(w.runs.some(r => r.includes('close') && r.includes('w1:p50'))).toBe(false)
  })

  test('the orchestrator tab is still exempt from layout hygiene', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    const cfg = w.json(`${w.team}/config.json`)
    w.writeJson(`${w.team}/config.json`, { ...cfg, orchestrator_tab: 'w1:t6' })
    w.writeJson(`${w.team}/tabs.json`, ['w1:t6'])
    w.writeJson(`${w.team}/app-1-gone.json`, { role: 'tester', topic: '', brief: '', pane: 'w1:p51', session: 'sid-gone' })
    w.panes = [{ pane_id: 'w1:p51', tab_id: 'w1:t6', agent_status: 'none' }]
    await w.clock.advance(15000)
    expect(w.runs.some(r => r.includes('close') && r.includes('w1:p51'))).toBe(false)
  })

  test('brief_send stays with the orchestrator session', async ($, on) => {
    await envoyTeam($, on)
    expect(await $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', name: 'app-1-scout', topic: 'dig' } as never))
      .toMatchObject({ isError: true })
  })

  test('the envoy half writes no pane id back to a record', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [{ pane_id: 'w1:p7', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p2')
  })

  test('the orchestrator half writes a moved pane id back to the record', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.agents = [{ pane_id: 'w1:p7', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p7')
  })
})

describe('an envoy session before the orchestrator started', () => {
  const beforeOrchestrator = async ($: any, on: any) => {
    const w = await envoyTeam($, on)
    const { orchestrator_session: _gone, ...cfg } = w.json(`${w.team}/config.json`)
    w.writeJson(`${w.team}/config.json`, cfg)
    return w
  }

  test('queue works', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    card(w, 1, { tag: 'fixtures' })
    const r = await call($, 'queue', {})
    expect(r.isError).toBeUndefined()
    expect(JSON.parse(r.result).groups[0]).toMatchObject({ tag: 'fixtures', count: 1 })
  })

  test('decide works', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    w.write(`${w.cwd}/scratchpad/current/decisions-APP-1.md`, HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Use real fixtures.', rationale: 'It hides the bug.' }))
      .toMatchObject({ result: 'Decision 1' })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ status: 'answered', decision: 1 })
  })

  test('relay is an envoy tool that says there is no orchestrator to reach', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    expect(await call($, 'relay', { message: 'start with the tests' })).toMatchObject({
      isError: true, result: 'relay needs a running orchestrator: the config has no orchestrator_session',
    })
    expect(w.sends).toEqual([])
  })

  test('the envoy half runs: it opens the pane', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
  })

  test('the orchestrator half stays inactive: no prompt, no brief_send', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.submits).toEqual([])
    expect(await $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', name: 'app-1-scout', topic: 'dig' } as never))
      .toMatchObject({ isError: true })
  })

  test('decisions made before the orchestrator started arrive once, at its first tick', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    w.write(`${w.cwd}/scratchpad/current/decisions-APP-1.md`, HEAD)
    card(w, 1)
    await call($, 'decide', { cards: ['Q-1'], answer: 'Use real fixtures.', rationale: 'It hides the bug.' })
    await w.clock.advance(15000)
    expect(w.submits).toEqual([])
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), orchestrator_session: 'sid-orch-worker' })
    w.id = 'sid-orch-worker'
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
  })

  test('a session that is not the envoy gets nothing', async ($, on) => {
    const w = await beforeOrchestrator($, on)
    w.id = 'sid-stranger'
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
    expect(w.submits).toEqual([])
    expect(await call($, 'queue', {})).toMatchObject({ isError: true, result: 'queue works only in the envoy session' })
  })
})
