import { describe, expect, test } from 'claude-code/testing'
import { team } from './world'

const call = ($: any, args: { name: string; topic: string }) =>
  $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', ...args } as never)

describe('brief_send', () => {
  test('sends the kickoff to the record session and returns its state', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    const r = await call($, { name: 'app-1-scout', topic: 'dig' })
    expect(r).toMatchObject({ result: 'app-1-scout: idle' })
    expect(w.sends).toEqual([{ to: 'sid-scout',
                               text: 'Read scratchpad/current/brief-app-1-scout-dig.md and execute it fully.' }])
    expect(w.json(`${w.team}/app-1-scout.json`).brief_sent_session).toBe('sid-scout')
  })

  test('an unknown agent is an error', async ($, on) => {
    const w = await team($, on)
    const r = await call($, { name: 'app-1-ghost', topic: 'dig' })
    expect(r).toMatchObject({ isError: true, result: 'no agent record: app-1-ghost' })
    expect(w.sends).toEqual([])
  })

  test('a record without a session id is an error', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-old.json`, { role: 'tester', topic: '', brief: '', pane: 'w1:p4' })
    const r = await call($, { name: 'app-1-old', topic: 'dig' })
    expect(r).toMatchObject({ isError: true })
    expect(w.sends).toEqual([])
  })

  test('waits for a /clear to land, then fails well inside the 10 s hook budget', async ($, on) => {
    const w = await team($, on)
    const rec = w.json(`${w.team}/app-1-scout.json`)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout' })
    const pending = call($, { name: 'app-1-scout', topic: 'dig' })
    await w.clock.advance(6_500)
    expect(await pending).toMatchObject({ isError: true, result: 'app-1-scout was not cleared since its last brief' })
    expect(w.sends).toEqual([])
  })

  test('sends once the cleared session id lands', async ($, on) => {
    const w = await team($, on)
    const rec = w.json(`${w.team}/app-1-scout.json`)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout' })
    const pending = call($, { name: 'app-1-scout', topic: 'dig' })
    await w.clock.advance(1000)
    w.writeJson(`${w.team}/app-1-scout.json`, { ...rec, brief_sent_session: 'sid-scout', session: 'sid-new' })
    await w.clock.advance(1000)
    const r = await pending
    expect(r.isError).toBeUndefined()
    expect(w.sends[0]?.to).toBe('sid-new')
    expect(w.json(`${w.team}/app-1-scout.json`).brief_sent_session).toBe('sid-new')
  })
})
