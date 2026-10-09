import { describe, expect, test } from 'claude-code/testing'
import { closeHides } from '../../hooks/mod/pane'
import { agentRows, card, CWD, start, team, world } from './world'

describe('closeHides', () => {
  test('a close by the person hides the overview', () => {
    expect(closeHides({ kind: 'person' })).toBe(true)
  })

  test('a close by a plugin does not', () => {
    expect(closeHides({ kind: 'plugin' })).toBe(false)
  })

  test('a close on unload does not', () => {
    expect(closeHides({ kind: 'unload' })).toBe(false)
  })
})

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
    expect(w.opened).toEqual(['team', 'questions'])
  })

  test('does not open again on later ticks', async ($, on) => {
    const w = await activeTeam($, on)
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
  })

  test('draws plan items as glyph rows, not markdown', async ($, on) => {
    await activeTeam($, on)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 60 } } as never)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /▶ 3\. Build/ })).toBeDefined()
  })

  test('/team-overview hides and shows both tabs, and the choice is stored', async ($, on) => {
    const w = await activeTeam($, on)
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview hidden.' })
    expect([...w.closed].sort()).toEqual(['questions', 'team'])
    expect(w.store.get('overviewHidden:app-1')).toBe(true)
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview shown.' })
    expect(w.opened).toEqual(['team', 'questions', 'team', 'questions'])
    expect(w.store.get('overviewHidden:app-1')).toBe(false)
  })

  test('/team-overview shows panes that are open but not placed, instead of hiding them', async ($, on) => {
    const w = world(on)
    w.unplaced.add('team')
    w.unplaced.add('questions')
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
    })
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team', 'questions'])
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview shown.' })
    expect(w.closed).toEqual([])
    expect(w.opened).toEqual(['team', 'questions', 'team', 'questions'])
    expect(w.store.get('overviewHidden:app-1')).toBe(false)
    // An asked open is placed at any width, so the panes are placed now and the next call hides them.
    w.unplaced.clear()
    expect(await $.command.run({ command: 'team-overview' } as never)).toMatchObject({ text: 'Team overview hidden.' })
    expect([...w.closed].sort()).toEqual(['questions', 'team'])
    expect(w.store.get('overviewHidden:app-1')).toBe(true)
  })

  test('each tab opens under its own title', async ($, on) => {
    const w = await activeTeam($, on)
    expect(w.titles.get('team')).toBe('Team')
    expect(w.titles.get('questions')).toBe('Questions')
  })

  test('the question log lists every card, newest first, with how it closed', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'answered', decision: 3, door: 'one-way', from: 'app-1-scout', tag: 'fixtures' })
    card(w, 2, { from: 'app-1-tester', tag: 'auth' })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'questions', props: { bodyColumns: 100 } } as never)
    const rows = (await ui.findAll({ type: 'Text', text: /^Q-\d/ })).map((t: any) => t.text.replace(/\s+/g, ' '))
    expect(rows[0]).toMatch(/^Q-2 open two-way app-1-tester\/auth: /)
    expect(rows[1]).toMatch(/^Q-1 answered #3 one-way app-1-scout\/fixtures: /)
  })

  test('an empty question log says so', async ($, on) => {
    await activeTeam($, on)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'questions', props: { bodyColumns: 100 } } as never)
    expect(await ui.find({ type: 'Text', text: /no questions yet/ })).toBeDefined()
  })

  test('the question log shows obsolete and assumed cards too', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'obsolete', reason: 'superseded' })
    card(w, 2, { status: 'assumed' })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'questions', props: { bodyColumns: 100 } } as never)
    const rows = (await ui.findAll({ type: 'Text', text: /^Q-\d/ })).map((t: any) => t.text.replace(/\s+/g, ' '))
    expect(rows[0]).toMatch(/^Q-2 assumed two-way /)
    expect(rows[1]).toMatch(/^Q-1 obsolete two-way /)
  })

  test('pressing an agent row focuses its herdr pane', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(15000)
    await agentRows($)

    await $.ui.press({ plugin: 'team', key: 'app-1-scout' })

    expect(w.runs).toContainEqual(['herdr', 'agent', 'focus', 'w1:p2'])
  })

  test('a failed focus shows the herdr reason in the pane', async ($, on) => {
    const w = await team($, on)
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    w.herdrFails = 'no agent w1:p2'

    await $.ui.press({ plugin: 'team', key: 'app-1-scout' })

    expect(await ui.find({ type: 'Text', text: /focus app-1-scout: no agent w1:p2/ })).toBeDefined()
  })

  test('agent rows carry hotkeys 1 to 9 in order, the tenth none', async ($, on) => {
    const w = await team($, on)
    for (let i = 2; i <= 10; i++) {
      w.writeJson(`${w.team}/app-1-w${i}.json`, { role: 'implementer', topic: '', brief: '', pane: `w1:p${i + 10}`, session: `sid-${i}` })
    }
    await w.clock.advance(15000)

    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    const buttons = await ui.findAll({ type: 'Button', text: /app-1-/ })

    expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', undefined])
  })

  test('shows the open queue by tag with urgent cards on top', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { tag: 'fixtures' })
    card(w, 2, { tag: 'fixtures', status: 'assumed' })
    card(w, 3, { tag: 'auth', urgent: true, from: 'app-1-tester', question: 'Approve rm -rf build?' })
    card(w, 4, { tag: 'auth', status: 'answered', decision: 1 })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
    const at = (re: RegExp) => texts.findIndex((t: string) => re.test(t))
    expect(at(/^Questions \(2 open, 1 assumed\)$/)).toBeGreaterThan(-1)
    expect(at(/! Q-3 app-1-tester: Approve rm -rf build\?/)).toBeLessThan(at(/fixtures +1 open +1 assumed/))
    expect(at(/auth +1 open/)).toBeGreaterThan(-1)
  })

  test('says so when no card is open', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'answered', decision: 1 })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /Questions: none open/ })).toBeDefined()
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
