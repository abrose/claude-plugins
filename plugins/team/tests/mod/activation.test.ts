import { describe, expect, test } from 'claude-code/testing'
import { start, world } from './world'

describe('activation', () => {
  test('sets TEAM_SESSION_ID on session start', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.sessionId()).toBe('sid-orch')
  })

  test('stays inactive without a team config', async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
  })

  test('stays inactive for a config without orchestrator_session', async ($, on) => {
    const w = world(on)
    w.writeJson(`${w.team}/config.json`, { team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch' })
    await start($)
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
  })

  test('follows its own /clear', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'sid-orch',
    })
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-after-clear'
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBe('sid-after-clear')
    expect(w.sessionId()).toBe('sid-after-clear')
  })

  test('/team-overview right after its own /clear still finds the team', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'sid-orch',
    })
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-after-clear'
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview shown.' })
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBe('sid-after-clear')
  })

  test('brief_send right after its own /clear still finds the team', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'sid-orch',
    })
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-after-clear'
    const r = await $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', name: 'app-1-scout', topic: 'dig' } as never)
    expect(r.isError).toBeUndefined()
    expect(w.sends.map(s => s.to)).toEqual(['sid-scout'])
  })

  test('ignores a /clear of another session', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'other',
    })
    await $.session.end({ reason: 'clear', sessionId: 'old-id', resume: { id: '' } } as never)
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBe('other')
  })
})
