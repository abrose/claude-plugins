import { describe, expect, test } from 'claude-code/testing'
import { call, team } from './world'
import type { World } from './world'

const SUB = '/proj/sub/dir'

/** The options the mod passed to the process.run of the first call to a bin/ script. */
const initOf = (w: World, script: string) => {
  const i = w.runs.findIndex(argv => (argv[0] ?? '').endsWith(`/bin/${script}`))
  expect(i).toBeGreaterThanOrEqual(0)
  return w.inits[i]
}

describe('subprocess environment', () => {
  test('team-brief runs in the main checkout with the absolute run dir in its env', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(initOf(w, 'team-brief')).toMatchObject({
      cwd: '/proj',
      env: { TEAM_SCRATCH: '/proj/scratchpad/current' },
    })
  })

  test('a shell cd does not move the cwd or the run dir it passes', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.cwd = SUB
    await $.session.start({ cwd: SUB, surface: 'terminal', isInteractive: true })
    await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(initOf(w, 'team-brief')).toMatchObject({
      cwd: '/proj',
      env: { TEAM_SCRATCH: '/proj/scratchpad/current' },
    })
  })

  test('an absolute TEAM_SCRATCH in the session env is passed on as it is, with no git run for a cwd', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.env.set('TEAM_SCRATCH', '/elsewhere/run')
    w.writeJson('/elsewhere/run/.team/config.json', {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
    })
    w.writeJson('/elsewhere/run/.team/app-1-scout.json', {
      role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout',
    })
    w.runs.length = 0
    w.inits.length = 0
    await call($, 'brief_send', { name: 'app-1-scout', topic: 'dig' })
    expect(initOf(w, 'team-brief')).toMatchObject({ env: { TEAM_SCRATCH: '/elsewhere/run' } })
    expect(initOf(w, 'team-brief')?.cwd).toBeUndefined()
    expect(w.runs.filter(a => a[0] === 'git')).toEqual([])
  })
})
