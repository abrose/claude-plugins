import { describe, expect, test } from 'claude-code/testing'
import { call, envoyTeam, team } from './world'

const SUB = '/proj/sub/dir'

/** A shell `cd` in the session: the cwd moves, a later session.start reports it, the project root stays. */
const cd = async ($: any, w: { cwd: string }) => {
  w.cwd = SUB
  await $.session.start({ cwd: SUB, surface: 'terminal', isInteractive: true })
}

describe('run directory after a cd', () => {
  test('brief_send still finds the agent record under the project root', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await cd($, w)
    const r = await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
    expect(w.sends).toHaveLength(1)
    expect(w.json(`${w.team}/app-1-scout.json`).brief_sent_session).toBe('sid-scout')
    expect([...w.files.keys()].filter(p => p.startsWith(SUB))).toEqual([])
  })

  test('decide still writes the decisions file under the project root', async ($, on) => {
    const w = await envoyTeam($, on)
    const decisions = `${w.root}/scratchpad/current/decisions-APP-1.md`
    w.write(decisions, '# Decisions APP-1\n')
    w.writeJson(`${w.team}/questions/Q-1.json`, {
      id: 'Q-1', n: 1, from: 'app-1-scout', tag: 'general', context: 'c', question: 'q?',
      options: [], recommendation: 'r', blocks: 'b', door: 'two-way', rework: '~1 h',
      urgent: false, refs: [], status: 'open', at: w.clock.now(),
    })
    await cd($, w)
    const r = await call($, 'decide', { cards: ['Q-1'], answer: 'Yes.', rationale: 'Because.' })
    expect(r).toMatchObject({ result: 'Decision 1' })
    expect(w.files.get(decisions)!.text).toContain('1. (')
    expect([...w.files.keys()].filter(p => p.startsWith(SUB))).toEqual([])
  })
})
