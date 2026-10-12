import { describe, expect, test } from 'claude-code/testing'
import { closeHides, drawPane, drawQuestions, pruneExpanded } from '../../hooks/mod/pane'
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

/** Fake elements: each draws as a plain node, so the tree can be walked without a mount. */
const fake = (type: string) => (props: any) => ({ type, props })
const fakes = { Box: fake('Box'), Text: fake('Text'), Button: fake('Button') } as any

/** Every string in a drawn tree, in order. */
function strings(node: any): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(strings)
  return strings(node.props?.children)
}

const sample = (over: object = {}) => ({
  id: 'Q-1', n: 1, from: 'app-1-tester', tag: 'auth', context: 'ctx', question: 'Q?',
  options: [{ option: 'a', cost: '1 h' }], recommendation: 'a', blocks: 'x', door: 'two-way' as const,
  rework: '1 h', urgent: false, refs: [], status: 'open' as const, at: 0, ...over,
})

const paneView = (over: object = {}) => ({
  agents: [], idle: [], cards: [], teamId: 'app-1', planPath: '/p', tickAt: '12:00:01', error: '', rows: 40,
  version: '', plan: { title: 'APP-1', waits: [], done: [], running: [], next: [] }, ...over,
})

describe('drawPane plan sections', () => {
  const plan = {
    title: 'APP-1',
    waits: [{ mark: '?', text: '5. Pick the fixture set' }],
    done: [{ mark: 'x', text: '1. Analysis' }],
    running: [{ mark: '>', text: '3. Build' }],
    next: [{ mark: ' ', text: '4. Gate' }],
  }

  test('WAITS ON YOU is drawn first, before DONE, RUNNING and NEXT', () => {
    const all = strings(drawPane(fakes, paneView({ plan }) as never))
    const at = (t: string) => all.indexOf(t)
    expect(at('WAITS ON YOU')).toBeGreaterThan(-1)
    expect(at('WAITS ON YOU')).toBeLessThan(at('DONE'))
    expect(at('DONE')).toBeLessThan(at('RUNNING'))
    expect(at('RUNNING')).toBeLessThan(at('NEXT'))
  })

  test('a waiting item has its own glyph, not the urgent !', () => {
    const line = strings(drawPane(fakes, paneView({ plan }) as never)).join('')
    expect(line).toContain('5. Pick the fixture set')
    expect(line).not.toContain('! 5. Pick')
    expect(line).toMatch(/[^ ] 5\. Pick the fixture set/)
  })

  test('an empty WAITS ON YOU section draws nothing', () => {
    const all = strings(drawPane(fakes, paneView({ plan: { ...plan, waits: [] } }) as never))
    expect(all).not.toContain('WAITS ON YOU')
    expect(all).toContain('DONE')
  })
})

describe('drawPane footer', () => {
  const footer = (over: object) =>
    strings(drawPane(fakes, paneView(over) as never)).join('|').match(/(?:team [^|]*)?tick [^|]*/)?.[0]

  test('carries the plugin version before the tick time', () => {
    expect(footer({ version: '0.8.0' })).toBe('team 0.8.0  tick 12:00:01')
  })

  test('without a version the footer is the old one', () => {
    expect(footer({ version: '' })).toBe('tick 12:00:01')
  })
})

describe('drawQuestions glyphs', () => {
  test('every glyph, expand markers included, comes from CARD_GLYPH and flips with ascii', () => {
    const view = { cards: [sample()], teamId: 'app-1', expanded: [], toggle: () => {} }
    const unicode = strings(drawQuestions(fakes, { ...view, ascii: false } as never)).join('')
    const ascii = strings(drawQuestions(fakes, { ...view, ascii: true } as never)).join('')
    expect(unicode).toContain('▸')
    expect(ascii).toBe('> ? Q-1 2 tester/auth: Q?')
    expect(/[^\x00-\x7f]/.test(ascii)).toBe(false)
  })

  test('the open marker is v in ascii', () => {
    const view = { cards: [sample()], teamId: 'app-1', expanded: ['Q-1'], toggle: () => {}, ascii: true }
    expect(strings(drawQuestions(fakes, view as never)).join('')).toMatch(/^v \? Q-1 /)
  })
})

describe('drawQuestions one-line headline', () => {
  const long = sample({ question: 'Should the Questions tab draw every glyph in ASCII when the terminal is narrow?' })
  const width = (s: string) => Array.from(s).length
  const headline = (columns: number | undefined, card = long) =>
    strings(drawQuestions(fakes, { cards: [card], teamId: 'app-1', expanded: [], toggle: () => {}, columns } as never)).join('')

  test('a long headline is cut to the pane width and ends with an ellipsis', () => {
    const line = headline(36)
    expect(width(line)).toBe(36)
    expect(line.endsWith('…')).toBe(true)
    expect(line.startsWith('▸ ● Q-1 ⇄ tester/auth: Should')).toBe(true)
  })

  test('a headline that fits is left whole', () => {
    expect(headline(36, sample())).toBe('▸ ● Q-1 ⇄ tester/auth: Q?')
  })

  test('an exact fit is not cut', () => {
    const exact = '▸ ● Q-1 ⇄ tester/auth: Q?'
    expect(headline(width(exact), sample())).toBe(exact)
    expect(headline(width(exact) - 1, sample()).endsWith('…')).toBe(true)
  })

  test('no width given: no cut', () => {
    expect(headline(undefined)).toContain('narrow?')
  })

  test('the status glyph keeps its own colored Text', () => {
    const tree: any = drawQuestions(fakes, { cards: [long], teamId: 'app-1', expanded: [], toggle: () => {}, columns: 36 } as never)
    const colored: any[] = []
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'Text' && n.props.color !== undefined) colored.push(n)
      walk(n.props?.children)
    }
    walk(tree)
    expect(colored).toHaveLength(1)
    expect(strings(colored[0])).toEqual(['●'])
  })
})

describe('drawQuestions urgent mark', () => {
  const headline = (card: object, ascii = false) =>
    drawQuestions(fakes, { cards: [sample(card)], teamId: 'app-1', expanded: [], toggle: () => {}, ascii } as never)
  const coloredTexts = (tree: any) => {
    const found: any[] = []
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'Text' && n.props.color !== undefined) found.push(n)
      walk(n.props?.children)
    }
    walk(tree)
    return found
  }

  test('an urgent open card draws a red ! in place of the status glyph, the layout unchanged', () => {
    const tree = headline({ urgent: true })
    expect(strings(tree).join('')).toBe('▸ ! Q-1 ⇄ tester/auth: Q?')
    const colored = coloredTexts(tree)
    expect(colored).toHaveLength(1)
    expect(colored[0].props.color).toBe('red')
    expect(strings(colored[0])).toEqual(['!'])
  })

  test('an urgent parked card is marked too', () => {
    expect(strings(headline({ urgent: true, status: 'assumed' })).join('')).toBe('▸ ! Q-1 ⇄ tester/auth: Q?')
  })

  test('an urgent card that is resolved keeps its status glyph', () => {
    expect(strings(headline({ urgent: true, status: 'answered' })).join('')).toBe('▸ ✓ Q-1 ⇄ tester/auth: Q?')
  })

  test('a card that is not urgent is unchanged', () => {
    expect(strings(headline({ urgent: false })).join('')).toBe('▸ ● Q-1 ⇄ tester/auth: Q?')
  })

  test('the mark stays one ASCII column wide', () => {
    expect(strings(headline({ urgent: true }, true)).join('')).toBe('> ! Q-1 2 tester/auth: Q?')
  })
})

describe('drawQuestions expanded block', () => {
  test('one Box indents the block by 4 columns, so no line carries leading spaces', () => {
    const view = { cards: [sample()], teamId: 'app-1', expanded: ['Q-1'], toggle: () => {} }
    const tree: any = drawQuestions(fakes, view as never)
    const boxes: any[] = []
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'Box') boxes.push(n)
      walk(n.props?.children)
    }
    walk(tree)
    const indented = boxes.filter(b => b.props.paddingLeft === 4)
    expect(indented).toHaveLength(1)
    const lines = strings(indented[0])
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.every(l => !l.startsWith(' '))).toBe(true)
  })
})

describe('pruneExpanded', () => {
  test('keeps only ids of current cards', () => {
    expect(pruneExpanded(['Q-1', 'Q-9'], [sample() as never])).toEqual(['Q-1'])
  })

  test('returns the same array when nothing goes, so the caller can skip the write', () => {
    const ids = ['Q-1']
    expect(pruneExpanded(ids, [sample() as never])).toBe(ids)
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

const mountQuestions = ($: any) =>
  $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
               requestId: 'questions', props: { bodyColumns: 100 } } as never)

/** The collapsed or expanded headline rows of the Questions tab, in order. */
async function questionRows(ui: any): Promise<string[]> {
  return (await ui.findAll({ type: 'Button', text: /^[▸▾] / })).map((b: any) => b.text.replace(/\s+/g, ' '))
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

  test('the footer shows the version read from plugin.json at session start', async ($, on) => {
    const w = world(on)
    w.pluginJson = JSON.stringify({ name: 'team', version: '0.8.0' })
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: w.id,
    })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 60 } } as never)
    expect(await ui.find({ type: 'Text', text: /^team 0\.8\.0 +tick \d/ })).toBeDefined()
  })

  test('the footer has no version when plugin.json cannot be read', async ($, on) => {
    await activeTeam($, on)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 60 } } as never)
    expect(await ui.find({ type: 'Text', text: /^tick \d/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^team \d/ })).toBeUndefined()
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
    const rows = await questionRows(ui)
    expect(rows[0]).toMatch(/^▸ ● Q-2 ⇄ tester\/auth: /)
    expect(rows[1]).toMatch(/^▸ ✓ Q-1 #3 → scout\/fixtures: /)
  })

  test('the source loses the team id only when the prefix matches', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { from: 'app-1-tester' })
    card(w, 2, { from: 'other-9-tester' })
    await w.clock.advance(15000)
    const rows = await questionRows(await mountQuestions($))
    expect(rows[0]).toMatch(/^▸ ● Q-2 ⇄ other-9-tester: /)
    expect(rows[1]).toMatch(/^▸ ● Q-1 ⇄ tester: /)
  })

  test('the /general tag is dropped and a real topic stays', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { from: 'app-1-orch', tag: 'general' })
    card(w, 2, { from: 'app-1-tester', tag: 'auth' })
    await w.clock.advance(15000)
    const rows = await questionRows(await mountQuestions($))
    expect(rows[0]).toMatch(/^▸ ● Q-2 ⇄ tester\/auth: /)
    expect(rows[1]).toMatch(/^▸ ● Q-1 ⇄ orch: /)
  })

  test('each status has its glyph and each door its arrow', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'open', door: 'one-way' })
    card(w, 2, { status: 'assumed' })
    card(w, 3, { status: 'answered', decision: 4 })
    card(w, 4, { status: 'obsolete', reason: 'superseded' })
    await w.clock.advance(15000)
    const rows = await questionRows(await mountQuestions($))
    expect(rows[0]).toMatch(/^▸ ✗ Q-4 ⇄ /)
    expect(rows[1]).toMatch(/^▸ ✓ Q-3 #4 ⇄ /)
    expect(rows[2]).toMatch(/^▸ ◐ Q-2 ⇄ /)
    expect(rows[3]).toMatch(/^▸ ● Q-1 → /)
  })

  test('pressing a question row expands the full card in place and pressing again collapses it', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { blocks: 'fix round 2 (impl)', rework: '2 h' })
    await w.clock.advance(15000)
    const ui = await mountQuestions($)
    expect(await ui.find({ type: 'Text', text: /Context: Fixtures load/ })).toBeUndefined()

    await $.ui.press({ plugin: 'team', key: 'Q-1' })

    expect((await questionRows(ui))[0]).toMatch(/^▾ ● Q-1 /)
    expect(await ui.find({ type: 'Text', text: /Use real fixtures or the snapshot\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Context: Fixtures load/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\. real fixtures \(~1 h\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2\. snapshot \(none\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rec: real fixtures: the snapshot hides the bug/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Blocks: fix round 2 \(impl\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Rework: 2 h +Door: two-way/ })).toBeDefined()

    await $.ui.press({ plugin: 'team', key: 'Q-1' })

    expect((await questionRows(ui))[0]).toMatch(/^▸ ● Q-1 /)
    expect(await ui.find({ type: 'Text', text: /Context: Fixtures load/ })).toBeUndefined()
  })

  test('an expanded obsolete card shows its reason', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'obsolete', reason: 'superseded by Q-2' })
    await w.clock.advance(15000)
    const ui = await mountQuestions($)
    await $.ui.press({ plugin: 'team', key: 'Q-1' })
    expect(await ui.find({ type: 'Text', text: /Reason: superseded by Q-2/ })).toBeDefined()
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
    const rows = await questionRows(ui)
    expect(rows[0]).toMatch(/^▸ ◐ Q-2 ⇄ /)
    expect(rows[1]).toMatch(/^▸ ✗ Q-1 ⇄ /)
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
    expect(at(/! Q-3 tester: Approve rm -rf build\?/)).toBeLessThan(at(/fixtures +1 open +1 assumed/))
    expect(at(/auth +1 open/)).toBeGreaterThan(-1)
  })

  test('the urgent row strips the team id from the source', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { urgent: true, from: 'app-1-tester', question: 'Approve?' })
    card(w, 2, { urgent: true, from: 'other-9-tester', question: 'Other?' })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Text', text: /! Q-1 tester: Approve\?/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /! Q-2 other-9-tester: Other\?/ })).toBeDefined()
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
