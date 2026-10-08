import { describe, expect, test } from 'claude-code/testing'
import { decisionLine, pickDecisions } from '../../hooks/mod/decisions'
import { start, team } from './world'

const entry = (n: number, more: object = {}) => ({
  n, answer: 'Use real fixtures.', rationale: 'r', overrides: [], at: 0,
  cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'fixtures' }, { id: 'Q-2', from: 'app-1-tester', tag: 'fixtures' }],
  ...more,
})

describe('decisionLine', () => {
  test('names every card with its agent and tag', () => {
    expect(decisionLine(entry(3)))
      .toBe('DECISION 3 (Q-1 app-1-scout/fixtures, Q-2 app-1-tester/fixtures): Use real fixtures.')
  })
  test('says which assumption it overrides', () => {
    expect(decisionLine(entry(3, { overrides: ['Q-1'] })))
      .toBe('DECISION 3 (Q-1 app-1-scout/fixtures, Q-2 app-1-tester/fixtures): Use real fixtures. - overrides assumption Q-1')
  })
})

describe('pickDecisions', () => {
  test('sends entries above the mark, in number order', () => {
    expect(pickDecisions([entry(5), entry(4), entry(3)], 3).lines.map(l => l.slice(0, 10)))
      .toEqual(['DECISION 4', 'DECISION 5'])
  })
  test('no mark yet sends every entry', () => {
    expect(pickDecisions([entry(1)], undefined)).toMatchObject({ mark: 1 })
  })
})

describe('DECISION delivery in the tick', () => {
  test('is sent once, after REPORT lines and before WATCH lines', async ($, on) => {
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
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits).toEqual([[
      'REPORT app-1-maker build: green',
      'DECISION 1 (Q-1 app-1-scout/fixtures, Q-2 app-1-tester/fixtures): Use real fixtures.',
      'WATCH app-1-scout: working -> blocked: Allow Bash(rm -rf build)? [y/n]',
    ].join('\n')])
    expect(w.json(`${w.team}/delivered.json`)).toMatchObject({ _decision: 1 })
  })

  test('exactly once across the orchestrator /clear', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(15000)
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-after-clear'
    await start($)
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
    w.writeJson(`${w.team}/decisions/2.json`, entry(2))
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 2 '))).toHaveLength(1)
  })

  test('a decision whose submit failed is sent on the next tick', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.submitFails = true
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
  })
})
