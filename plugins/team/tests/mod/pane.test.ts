import { describe, expect, test } from 'claude-code/testing'
import { CWD, start, world } from './world'

async function activeTeam($: any, on: any) {
  const w = world(on)
  await start($)
  w.writeJson(`${w.team}/config.json`, {
    team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
  })
  w.write(`${CWD}/scratchpad/current/progress-APP-1.md`, '# APP-1\n\n## RUNNING\n- [>] 3. Build\n')
  await w.clock.advance(15000)
  return w
}

describe('Team pane', () => {
  test('opens on activation', async ($, on) => {
    const w = await activeTeam($, on)
    expect(w.opened).toEqual(['team-overview'])
  })

  test('does not open again on later ticks', async ($, on) => {
    const w = await activeTeam($, on)
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team-overview'])
  })

  test('draws plan items as glyph rows, not markdown', async ($, on) => {
    await activeTeam($, on)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team-overview', props: { bodyColumns: 60 } } as never)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /▶ 3\. Build/ })).toBeDefined()
  })

  test('/team-overview hides and shows, and the choice is stored', async ($, on) => {
    const w = await activeTeam($, on)
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview hidden.' })
    expect(w.closed).toEqual(['team-overview'])
    expect(w.store.get('overviewHidden:app-1')).toBe(true)
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview shown.' })
    expect(w.store.get('overviewHidden:app-1')).toBe(false)
  })

  test('a hidden overview stays hidden when the mod activates again', async ($, on) => {
    const w = world(on)
    w.store.set('overviewHidden:app-1', true)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
    })
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
  })
})
