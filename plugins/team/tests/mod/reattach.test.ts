import { describe, expect, test } from 'claude-code/testing'
import { start, world } from './world'

const ORCH_ALIVE = { pane_id: 'w1:p9', tab_id: 'w1:t9', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }

/** A fresh session the human talks to, in a repo whose run names an older envoy session. */
async function freshSession($: any, on: any, cfg: object = {}) {
  const w = world(on)
  w.id = 'sid-human'
  await start($)
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
    orchestrator_session: 'sid-orch-worker', orchestrator_tab: 'w1:t9', envoy_session: 'sid-old-envoy', ...cfg,
  })
  return w
}

const reattach = ($: any) => $.command.run({ command: 'team-envoy' } as never)
const startRuns = (w: any) => w.runs.filter((r: string[]) => (r[0] ?? '').endsWith('/bin/team-orch-start'))

describe('/team-envoy', () => {
  test('with the orchestrator alive: records this session as the envoy and leaves the orchestrator alone', async ($, on) => {
    const w = await freshSession($, on)
    w.agents = [ORCH_ALIVE]
    const r = await reattach($)
    expect(r.text).toContain('This session is the envoy of app-1 now.')
    expect(r.text).toContain('The orchestrator runs (w1:p9); left alone.')
    expect(w.json(`${w.team}/config.json`)).toMatchObject({
      envoy_session: 'sid-human', orchestrator_session: 'sid-orch-worker', orchestrator_tab: 'w1:t9',
    })
    expect(startRuns(w)).toEqual([])
  })

  test('the envoy half works in this session from the next tick on', async ($, on) => {
    const w = await freshSession($, on)
    w.agents = [ORCH_ALIVE]
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
    await reattach($)
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
  })

  test('with the orchestrator gone: starts a new one from zero and records it', async ($, on) => {
    const w = await freshSession($, on)
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('This session is the envoy of app-1 now.')
    expect(r.text).toContain('The orchestrator session sid-orch-worker is gone: started a new orchestrator app-1-orch (w1:p20, sid-orch-new) from zero.')
    expect(w.json(`${w.team}/config.json`)).toMatchObject({
      envoy_session: 'sid-human', orchestrator_session: 'sid-orch-new', orchestrator_tab: 'w1:t20',
    })
  })

  test('a config without orchestrator_session gets a new orchestrator too', async ($, on) => {
    const w = await freshSession($, on, { orchestrator_session: undefined })
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('No orchestrator session is recorded: started a new orchestrator app-1-orch (w1:p20, sid-orch-new) from zero.')
  })

  test('with no run: refuses and names /team:init', async ($, on) => {
    const w = world(on)
    await start($)
    const r = await reattach($)
    expect(r.text).toBe('No team run in this repo: start one with /team:init <ticket>.')
    expect([...w.files.keys()]).toEqual([])
    expect(startRuns(w)).toEqual([])
  })

  test('a failed start says why, and the envoy is recorded all the same', async ($, on) => {
    const w = await freshSession($, on)
    w.fails.set('team-orch-start', 'orchestrator did not start: status bar mismatch')
    const r = await reattach($)
    expect(r.text).toContain('This session is the envoy of app-1 now.')
    expect(r.text).toContain('The orchestrator is gone and no new one started: orchestrator did not start: status bar mismatch')
    expect(w.json(`${w.team}/config.json`)).toMatchObject({ envoy_session: 'sid-human', orchestrator_session: 'sid-orch-worker' })
  })

  test('a startup dialog tells the human to answer it, close the pane and run /team-envoy again', async ($, on) => {
    const w = await freshSession($, on)
    w.fails.set('team-orch-start', 'orchestrator did not start: app-1-orch is at a startup dialog in pane w1:p20.')
    const r = await reattach($)
    expect(r.text).toContain('Answer the dialog in that pane, close the pane, then run /team-envoy again.')
  })

  test('a herdr failure starts nothing: the orchestrator state is unknown', async ($, on) => {
    const w = await freshSession($, on)
    w.herdrFails = 'herdr: no server'
    const r = await reattach($)
    expect(r.text).toContain('This session is the envoy of app-1 now.')
    expect(r.text).toContain('Cannot tell whether the orchestrator runs (herdr: no server); started none. Run /team-envoy again when herdr answers.')
    expect(startRuns(w)).toEqual([])
    expect(w.json(`${w.team}/config.json`).envoy_session).toBe('sid-human')
  })

  test('the orchestrator session itself is refused', async ($, on) => {
    const w = await freshSession($, on)
    w.id = 'sid-orch-worker'
    w.agents = [ORCH_ALIVE]
    const r = await reattach($)
    expect(r.text).toBe('This session runs the orchestrator of app-1; run /team-envoy in the session you talk to.')
    expect(w.json(`${w.team}/config.json`).envoy_session).toBe('sid-old-envoy')
  })

  test('an orchestrator start under way elsewhere is left alone', async ($, on) => {
    const w = await freshSession($, on, { orchestrator_session: undefined })
    w.orchLocked = true
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('This session is the envoy of app-1 now.')
    expect(r.text).toContain('No orchestrator session is recorded, but an orchestrator is starting; left alone.')
    expect(r.text).not.toContain('no new one started')
    expect(w.json(`${w.team}/config.json`).orchestrator_session).toBeUndefined()
  })

  test('an orchestrator that team-orch-start finds live after its lock is left alone', async ($, on) => {
    const w = await freshSession($, on)
    w.orchRunsIn = 'w1:p4'
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('The orchestrator session sid-orch-worker is gone, but an orchestrator runs (w1:p4); left alone.')
    expect(r.text).not.toContain('is starting')
  })

  test('right after an orchestrator /clear: an agent with the orchestrator name counts as alive', async ($, on) => {
    const w = await freshSession($, on)
    w.agents = [{ ...ORCH_ALIVE, pane_id: 'w1:p7', agent_session: { value: 'sid-orch-cleared' }, name: 'app-1-orch' }]
    const r = await reattach($)
    expect(r.text).toContain('The orchestrator runs (w1:p7); left alone.')
    expect(startRuns(w)).toEqual([])
  })

  test('an agent in the recorded orchestrator pane counts as alive, named or not', async ($, on) => {
    const w = await freshSession($, on)
    w.writeJson(`${w.team}/app-1-orch.json`, { role: 'orchestrator', topic: '', brief: '', pane: 'w1:p9', session: 'sid-orch-worker' })
    w.agents = [{ ...ORCH_ALIVE, agent_session: { value: 'sid-orch-cleared' } }]
    const r = await reattach($)
    expect(r.text).toContain('The orchestrator runs (w1:p9); left alone.')
    expect(startRuns(w)).toEqual([])
  })

  test('a worker of the run in a reused orchestrator pane id does not count as the orchestrator', async ($, on) => {
    const w = await freshSession($, on)
    w.writeJson(`${w.team}/app-1-orch.json`, { role: 'orchestrator', topic: '', brief: '', pane: 'w1:p9', session: 'sid-orch-worker' })
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 't', brief: 'b', pane: 'w1:p2', session: 'sid-scout' })
    w.agents = [{ ...ORCH_ALIVE, agent_session: { value: 'sid-scout' } }]
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('The orchestrator session sid-orch-worker is gone')
  })

  test('this session in a reused orchestrator pane id does not count as the orchestrator', async ($, on) => {
    const w = await freshSession($, on)
    w.writeJson(`${w.team}/app-1-orch.json`, { role: 'orchestrator', topic: '', brief: '', pane: 'w1:p9', session: 'sid-orch-worker' })
    w.agents = [{ ...ORCH_ALIVE, agent_session: { value: 'sid-human' } }]
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('The orchestrator session sid-orch-worker is gone')
  })

  test('another agent named like a worker does not count as the orchestrator', async ($, on) => {
    const w = await freshSession($, on)
    w.agents = [{ ...ORCH_ALIVE, pane_id: 'w1:p2', agent_session: { value: 'sid-scout' }, name: 'app-1-scout' }]
    const r = await reattach($)
    expect(startRuns(w)).toHaveLength(1)
    expect(r.text).toContain('The orchestrator session sid-orch-worker is gone')
  })

  test('the old envoy session loses the envoy half', async ($, on) => {
    const w = await freshSession($, on)
    w.agents = [ORCH_ALIVE]
    await reattach($)
    w.id = 'sid-old-envoy'
    expect(await $.tool.call({ tool: 'mcp__team__queue', tool_use_id: 't1' } as never))
      .toMatchObject({ isError: true, result: 'queue works only in the envoy session' })
  })
})
