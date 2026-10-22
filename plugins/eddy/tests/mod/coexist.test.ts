import { describe, expect, test } from 'claude-code/testing'
import { card, envoyTeam, start, team, world } from './world'

const TEAM_ASK = { tool: 'mcp__team__ask', tool_use_id: 't1' } as never
const denyOf = (r: unknown) => (r as { deny?: string }).deny

describe('the team mod tools in an eddy session', () => {
  test('denies a team tool call in an active eddy session and names the eddy tool', async ($, on) => {
    on('tool.call', { tool: 'mcp__team__ask' }, () => ({ result: 'team answered' }))
    const w = await team($, on)

    expect(denyOf(await $.tool.call(TEAM_ASK))).toContain('mcp__eddy__ask')

    w.id = 'sid-scout'
    expect(denyOf(await $.tool.call(TEAM_ASK))).toContain('mcp__eddy__ask')
  })

  test('passes a team tool call on in a session eddy is not active in', async ($, on) => {
    on('tool.call', { tool: 'mcp__team__ask' }, () => ({ result: 'team answered' }))
    world(on)
    await start($)

    expect(await $.tool.call(TEAM_ASK)).toMatchObject({ result: 'team answered' })
  })

  test('lets a team tool call go on when the eddy-active check throws (fails open)', async ($, on) => {
    on('tool.call', { tool: 'mcp__team__ask' }, () => ({ result: 'team answered' }))
    const w = await team($, on)
    let throws = 0
    w.afterRead = () => {
      throws += 1
      throw new Error('disk gone')
    }

    expect(await $.tool.call(TEAM_ASK)).toMatchObject({ result: 'team answered' })
    expect(throws).toBeGreaterThan(0)
  })
})

describe('names the engine and the human see', () => {
  test('registers the commands eddy-overview and eddy-envoy', async ($, on) => {
    const w = world(on)
    await start($)

    expect(w.commands).toEqual(['eddy-overview', 'eddy-envoy'])
  })

  test('eddy-overview outside an eddy run says no eddy run', async ($, on) => {
    world(on)
    await start($)

    expect(await $.command.run({ command: 'eddy-overview' } as never)).toMatchObject({ text: 'No eddy run in this session.' })
  })

  test('opens the panes eddy and eddy-questions with eddy titles', async ($, on) => {
    const w = await envoyTeam($, on)
    await w.clock.advance(15000)

    expect(w.opened).toEqual(['eddy', 'eddy-questions'])
    expect(w.titles.get('eddy')).toBe('Eddy')
    expect(w.titles.get('eddy-questions')).toBe('Eddy questions')
  })

  test('submits next-action messages that start with NEXT-ACTION from the eddy mod', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [
      { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } },
      { pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } },
    ]
    await w.clock.advance(15000)
    card(w, 3)
    await w.clock.advance(15000)
    await w.clock.advance(15000)

    const pushes = w.submits.filter(s => s.startsWith('NEXT-ACTION'))
    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatch(/^NEXT-ACTION from the eddy mod\./)
  })
})

describe('the eddy run folder', () => {
  test('finds the run under scratchpad/eddy/current/.eddy without EDDY_SCRATCH', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson('/proj/scratchpad/eddy/current/.eddy/config.json', {
      team_id: 'eddy-app-1', ticket: 'APP-1', orchestrator: 'eddy-app-1-orch', orchestrator_session: w.id,
    })
    await w.clock.advance(15000)

    expect(w.opened).toEqual(['eddy', 'eddy-questions'])
    expect(w.sessionId()).toBe('sid-orch')
  })

  test('ignores TEAM_SCRATCH', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.env.set('TEAM_SCRATCH', '/elsewhere')

    await $.tool.call({ tool: 'mcp__eddy__brief_send', tool_use_id: 't1', name: 'app-1-scout', topic: 'dig' } as never)

    const i = w.runs.findIndex(argv => (argv[0] ?? '').endsWith('/bin/eddy-brief'))
    expect(i).toBeGreaterThanOrEqual(0)
    expect(w.inits[i]?.env).toEqual({ EDDY_SCRATCH: '/proj/scratchpad/eddy/current' })
  })
})
