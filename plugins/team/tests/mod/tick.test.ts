import { describe, expect, test } from 'claude-code/testing'
import { agentRows, team } from './world'

describe('agent rows', () => {
  test('maps records to herdr agents by session id, not name', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(await agentRows($)).toEqual(['working app-1-scout w1:p2'])
  })

  test('writes a moved pane id back to the record', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p7', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p7')
  })

  test('healing a pane keeps a session id written meanwhile by a /clear', async ($, on) => {
    const w = await team($, on)
    const path = `${w.team}/app-1-scout.json`
    let cleared = false
    w.afterRead = p => {
      if (p === path && !cleared) {
        cleared = true
        w.writeJson(path, { ...w.json(path), session: 'sid-after-clear' })
      }
    }
    w.agents = [{ pane_id: 'w1:p7', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    expect(w.json(path)).toMatchObject({ pane: 'w1:p7', session: 'sid-after-clear' })
  })

  test('a record whose session herdr does not list shows as gone', async ($, on) => {
    const w = await team($, on)
    w.agents = []
    await w.clock.advance(15000)
    expect(await agentRows($)).toEqual(['gone app-1-scout w1:p2'])
    expect(w.json(`${w.team}/app-1-scout.json`).pane).toBe('w1:p2')
    expect(w.submits).toEqual([])
  })

  test('uses HERDR_BIN_PATH when set', async ($, on) => {
    const w = await team($, on)
    w.env.set('HERDR_BIN_PATH', '/opt/homebrew/bin/herdr')
    await w.clock.advance(15000)
    expect(w.runs.some(r => r[0] === '/opt/homebrew/bin/herdr' && r[1] === 'agent')).toBe(true)
  })
})
