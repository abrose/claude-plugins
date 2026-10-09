import { describe, expect, test } from 'claude-code/testing'
import { call, team } from './world'

const COMMON = '--git-common-dir'
const commonCalls = (w: { runs: string[][] }) => w.runs.filter(a => a[0] === 'git' && a.includes(COMMON))

/** The agent record sits in the main checkout's run dir; the session stands in a linked worktree. */
async function inWorktree($: any, on: any) {
  const w = await team($, on)
  w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
  w.root = '/proj-wt'
  w.git = { common: '/proj/.git', top: '/proj-wt' }
  return w
}

describe('run directory in a linked worktree', () => {
  test('a relative TEAM_SCRATCH resolves under the main checkout', async ($, on) => {
    const w = await inWorktree($, on)
    const r = await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
    expect(w.json(`${w.team}/app-1-scout.json`).brief_sent_session).toBe('sid-scout')
    expect([...w.files.keys()].filter(p => p.startsWith('/proj-wt'))).toEqual([])
  })

  test('git runs from the session root with the common-dir query', async ($, on) => {
    const w = await inWorktree($, on)
    w.runs.length = 0
    w.gitCwds.length = 0
    await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(commonCalls(w)[0]).toEqual(['git', 'rev-parse', '--path-format=absolute', COMMON])
    expect(w.gitCwds[0]).toBe('/proj-wt')
  })

  test('a root with no .git suffix (submodule, bare) uses the git top level', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.root = '/elsewhere'
    w.git = { common: '/elsewhere/.git/modules/x', top: '/proj' }
    const r = await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
  })
})

describe('run directory outside git', () => {
  test('falls back to the session root', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.git = { common: null, top: null }
    const r = await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
    expect(w.runs.some(a => a[0] === 'git')).toBe(true)
  })
})

describe('an absolute TEAM_SCRATCH', () => {
  test('wins and runs no git', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.env.set('TEAM_SCRATCH', '/proj/scratchpad/current')
    w.root = '/proj-wt'
    w.git = { common: '/wrong/.git', top: '/wrong' }
    w.runs.length = 0
    const r = await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
    expect(w.runs.filter(a => a[0] === 'git')).toEqual([])
  })
})

describe('the root cache', () => {
  test('git is asked once across two ticks', async ($, on) => {
    const w = await inWorktree($, on)
    w.runs.length = 0
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(commonCalls(w)).toHaveLength(1)
  })
})
