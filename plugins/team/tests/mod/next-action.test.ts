import { describe, expect, test } from 'claude-code/testing'
import {
  changeList, draftHeld, nextActionBlock, nextActionDue, nextActionKey, nextActionPrompt, nextActionSnapshot,
  nextActionView,
} from '../../hooks/mod/next-action'
import { call, card as fileCard, DIALOG_TEXT, envoyTeam, start, team } from './world'

const NOW = 10_000_000
const MIN = 60_000

const card = (n: number, more: object = {}) =>
  ({
    id: `Q-${n}`, n, from: 'app-1-tester', tag: 'general', context: '', question: 'Use real fixtures?',
    options: [], recommendation: '', blocks: '', door: 'two-way', rework: '', urgent: false, refs: [],
    status: 'open', at: 0, ...more,
  }) as any

const agent = (more: object = {}) =>
  ({
    name: 'app-1-tester', role: 'tester', pane: 'w2:p3', topic: 'fixtures', state: 'working',
    briefed: true, briefedAt: NOW - 12 * MIN, dialog: '', ...more,
  }) as any

const plan = (more: object = {}) => ({ title: '', waits: [], done: [], running: [], next: [], ...more }) as any

const item = (text: string, mark = ' ') => ({ mark, text })

const input = (more: object = {}) => ({
  cards: [], plan: null, agents: [], filers: [], orchestratorGone: false, stalled: false, denials: [], now: NOW,
  ...more,
}) as any

describe('nextActionBlock', () => {
  test('an open card is the next action: its question, then its id and filer by role and pane', () => {
    const block = nextActionBlock(input({ cards: [card(3)], agents: [agent({ state: 'idle' })] }))

    expect(block).toBe([
      'Blocked on you: 1 thing waits.',
      'Next for you: Answer: Use real fixtures? (Q-3, from the tester (w2:p3))',
      'Running now: nothing',
      'After that: nothing planned',
    ].join('\n'))
  })

  test('the most pressing card leads; the rest are counted by id', () => {
    const cards = [card(1), card(2, { door: 'one-way' }), card(3, { urgent: true, question: 'Allow the post?' })]

    const block = nextActionBlock(input({ cards, agents: [agent({ state: 'idle' })] }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 3 things wait.',
      'Next for you: Answer: Allow the post? (Q-3, from the tester (w2:p3)). 2 more: Q-2, Q-1. Ask me to show them.',
    ])
  })

  test('a card from an agent with no record is named by its filer', () => {
    const block = nextActionBlock(input({ cards: [card(3, { from: 'app-1-gone' })] }))

    expect(block.split('\n')[1]).toBe('Next for you: Answer: Use real fixtures? (Q-3, from app-1-gone)')
  })

  test('a parked card is not a next action', () => {
    const block = nextActionBlock(input({ cards: [card(4, { status: 'assumed' })] }))

    expect(block).toBe([
      'Waiting on the team: all agents idle, no card open.',
      'Next for you: nothing - the team works on its own',
      'Running now: nothing',
      'After that: nothing planned',
    ].join('\n'))
  })

  test('a blocked worker asks to allow or deny its dialog', () => {
    const dialog = 'Bash command / rm -rf build / Allow Bash(rm -rf build)? [y/n]'

    const block = nextActionBlock(input({ agents: [agent({ state: 'blocked', dialog })] }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 1 thing waits.',
      `Next for you: Allow or deny a permission prompt in the tester's pane (w2:p3): ${dialog}`,
    ])
  })

  test('a [?] plan item without a card is the next action', () => {
    const block = nextActionBlock(input({ plan: plan({ waits: [item('Approve the release go (impl)', '?')] }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 1 thing waits.',
      'Next for you: Approve the release go (impl)',
    ])
  })

  test('a [?] step with no card stays in the block while a card is open, and counts as a thing that waits', () => {
    const waits = [item('manual test of the parser (tester)', '?')]

    const block = nextActionBlock(input({ cards: [card(3)], agents: [agent({ state: 'idle' })], plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 2 things wait.',
      'Next for you: Answer: Use real fixtures? (Q-3, from the tester (w2:p3)). ' +
        'Also waits in the plan: manual test of the parser (tester)',
    ])
  })

  test('a [?] step that names an open card is that card: one thing, no second line for it', () => {
    const waits = [item('answer Q-3: real fixtures or the snapshot (orch)', '?')]

    const block = nextActionBlock(input({ cards: [card(3)], agents: [agent({ state: 'idle' })], plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 1 thing waits.',
      'Next for you: Answer: Use real fixtures? (Q-3, from the tester (w2:p3))',
    ])
  })

  test('a [?] step that names Q-30 is no mirror of card Q-3', () => {
    const waits = [item('answer Q-30 (orch)', '?')]

    const block = nextActionBlock(input({ cards: [card(3)], agents: [agent({ state: 'idle' })], plan: plan({ waits }) }))

    expect(block.split('\n')[0]).toBe('Blocked on you: 2 things wait.')
  })

  test('a [?] step stays in the block while a worker is blocked on a dialog', () => {
    const waits = [item('go for the release (impl)', '?')]

    const block = nextActionBlock(input({ agents: [agent({ state: 'blocked', dialog: 'Allow Bash?' })], plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 2 things wait.',
      "Next for you: Allow or deny a permission prompt in the tester's pane (w2:p3): Allow Bash? " +
        'Also waits in the plan: go for the release (impl)',
    ])
  })

  test('the [?] steps follow the "Ask me to show them." sentence of a longer queue', () => {
    const waits = [item('manual test (tester)', '?')]
    const cards = [card(3), card(4, { urgent: true })]

    const block = nextActionBlock(input({ cards, agents: [agent({ state: 'idle' })], plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 3 things wait.',
      'Next for you: Answer: Use real fixtures? (Q-4, from the tester (w2:p3)). 1 more: Q-3. Ask me to show them. ' +
        'Also waits in the plan: manual test (tester)',
    ])
  })

  test('every [?] step shows, not only the first', () => {
    const waits = [item('manual test (tester)', '?'), item('go for the release (impl)', '?')]

    const block = nextActionBlock(input({ plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 2 things wait.',
      'Next for you: manual test (tester). Also waits in the plan: go for the release (impl)',
    ])
  })

  test('a card, its mirror step and a manual test: two things, only the test is named after the card', () => {
    const waits = [item('answer Q-3 (orch)', '?'), item('manual test (tester)', '?')]

    const block = nextActionBlock(input({ cards: [card(3)], agents: [agent({ state: 'idle' })], plan: plan({ waits }) }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Blocked on you: 2 things wait.',
      'Next for you: Answer: Use real fixtures? (Q-3, from the tester (w2:p3)). Also waits in the plan: manual test (tester)',
    ])
  })

  test('nothing waits: the state line says running', () => {
    const block = nextActionBlock(input({ agents: [agent()] }))

    expect(block.split('\n').slice(0, 2)).toEqual([
      'Running: nothing waits on you.',
      'Next for you: nothing - the team works on its own',
    ])
  })

  test('every step done: the state line says finished', () => {
    const block = nextActionBlock(input({ plan: plan({ done: [item('write the note (impl)', 'x')] }) }))

    expect(block.split('\n')[0]).toBe('Finished: every step is done.')
  })

  test('a gone orchestrator says to run /team-envoy', () => {
    const block = nextActionBlock(input({ orchestratorGone: true, agents: [agent()] }))

    expect(block.split('\n')[0]).toBe('Orchestrator gone: run /team-envoy to start a new one.')
  })

  test('running now names each working agent by role, pane and topic, with minutes since its brief', () => {
    const agents = [
      agent(),
      agent({ name: 'app-1-impl', role: 'implementer', pane: 'w2:p4', topic: 'adapter', briefedAt: NOW - 3 * MIN }),
      agent({ name: 'app-1-scout', role: 'investigator', pane: 'w2:p5', state: 'idle' }),
    ]

    const block = nextActionBlock(input({ agents }))

    expect(block.split('\n')[2]).toBe(
      'Running now: the tester (w2:p3) on fixtures, 12 min; the implementer (w2:p4) on adapter, 3 min')
  })

  test('running now falls back to the [>] plan items when no agent works', () => {
    const block = nextActionBlock(input({ plan: plan({ running: [item('fix round 2 (impl)', '>')] }) }))

    expect(block.split('\n')[2]).toBe('Running now: fix round 2 (impl)')
  })

  test('after that lists the first two next items', () => {
    const next = [item('one'), item('two'), item('three')]

    const block = nextActionBlock(input({ plan: plan({ next }), agents: [agent()] }))

    expect(block.split('\n')[3]).toBe('After that: one; two')
  })
})

describe('nextActionKey', () => {
  test('minutes spent do not change the key', () => {
    const at12 = nextActionBlock(input({ agents: [agent({ briefedAt: NOW - 12 * MIN })] }))
    const at13 = nextActionBlock(input({ agents: [agent({ briefedAt: NOW - 13 * MIN })] }))

    expect(at12).not.toBe(at13)
    expect(nextActionKey(at12)).toBe(nextActionKey(at13))
  })

  test('a done step changes the key, though the block text stays the same', () => {
    const running = plan({ running: [item('a', '>')], next: [item('d')] })
    const plain = input({ agents: [agent()], plan: running })
    const withDone = input({ agents: [agent()], plan: { ...running, done: [item('b (impl)', 'x')] } })

    expect(nextActionBlock(withDone)).toBe(nextActionBlock(plain))
    expect(nextActionView(withDone).key).not.toBe(nextActionView(plain).key)
  })

  test('a new [?] step that mirrors an open card changes the key, though the block text stays the same', () => {
    const plain = input({ agents: [agent()], cards: [card(3)] })
    const waiting = { ...plain, plan: plan({ waits: [item('answer Q-3 (orch)', '?')] }) }

    expect(nextActionBlock(waiting)).toBe(nextActionBlock(plain))
    expect(nextActionView(waiting).key).not.toBe(nextActionView(plain).key)
  })

  test('a stall changes the key, though the block text stays the same', () => {
    const plain = input({ agents: [agent({ state: 'idle' })], cards: [card(3)] })
    const stalled = { ...plain, stalled: true }

    expect(nextActionBlock(stalled)).toBe(nextActionBlock(plain))
    expect(nextActionView(stalled).key).not.toBe(nextActionView(plain).key)
  })

  test('a finished run changes the key while a card is open, though the block text stays the same', () => {
    const done = [item('d (impl)', 'x')]
    const plain = input({
      agents: [agent()], cards: [card(3)], plan: plan({ waits: [item('answer Q-3 (orch)', '?')], done }),
    })
    const finished = { ...plain, plan: plan({ done }) }

    expect(nextActionBlock(finished)).toBe(nextActionBlock(plain))
    expect(nextActionView(finished).key).not.toBe(nextActionView(plain).key)
  })

  test('a denial mark changes the key, though the block text stays the same', () => {
    const plain = input({ agents: [agent()] })
    const denied = { ...plain, denials: [{ name: 'app-1-tester', tool: 'Bash', at: NOW }] }

    expect(nextActionBlock(denied)).toBe(nextActionBlock(plain))
    expect(nextActionView(denied).key).not.toBe(nextActionView(plain).key)
  })

  test('a closed card changes the key; the block minus minutes stays the head of it', () => {
    const open = input({ agents: [agent()], cards: [card(3)] })
    const closed = { ...open, cards: [card(3, { status: 'answered', decision: 1 })] }

    expect(nextActionView(closed).key).not.toBe(nextActionView(open).key)
    expect(nextActionView(open).key.startsWith(nextActionKey(nextActionBlock(open)))).toBe(true)
  })
})

describe('changeList', () => {
  test('lists new, parked and answered cards, steps, denials and started agents, each with its id after the meaning', () => {
    const before = nextActionSnapshot(input({
      cards: [card(1)],
      agents: [agent({ state: 'idle' })],
      plan: plan({ running: [item('fix round 2 (impl)', '>')] }),
    }))
    const now = input({
      cards: [
        card(1, { status: 'answered', decision: 14 }),
        card(5, { urgent: true, from: 'app-1-reviewer', question: 'Allow the GitLab post of the 9 MR comments?' }),
        card(6, { status: 'assumed', question: 'Show time spent or an ETA?' }),
      ],
      agents: [
        agent(),
        agent({ name: 'app-1-reviewer', role: 'reviewer', pane: 'w2:p4', topic: 'review', state: 'blocked' }),
      ],
      plan: plan({
        waits: [item('Approve the post (impl)', '?')],
        done: [item('fix round 2 (impl)', 'x')],
      }),
      denials: [{ name: 'app-1-reviewer', tool: 'mcp__gitlab__save_note', at: NOW }],
    })

    expect(changeList(before, now)).toEqual([
      'New card: Allow the GitLab post of the 9 MR comments? (Q-5, urgent, from the reviewer (w2:p4))',
      'Parked card filed: Show time spent or an ETA? (Q-6)',
      'Card answered: Use real fixtures? (decision 14, Q-1)',
      'Step waits on you: Approve the post (impl)',
      'Step done: fix round 2 (impl)',
      'The reviewer (w2:p4) is blocked on a permission prompt',
      'Auto mode denied the reviewer (w2:p4) a tool call: mcp__gitlab__save_note',
      'Agent started: the tester (w2:p3) on fixtures',
    ])
  })

  test('is empty when the snapshot did not change', () => {
    const same = input({ cards: [card(3)], agents: [agent()], plan: plan({ next: [item('one')] }) })

    expect(changeList(nextActionSnapshot(same), same)).toEqual([])
  })

  test('names the stall, a gone orchestrator and a finished run', () => {
    const before = nextActionSnapshot(input())
    const now = input({
      stalled: true,
      orchestratorGone: true,
      plan: plan({ done: [item('write the note (impl)', 'x')] }),
    })

    expect(changeList(before, now)).toEqual([
      'Step done: write the note (impl)',
      'Every agent waits on you',
      'The orchestrator is gone',
      'The run is finished',
    ])
  })
})

describe('nextActionDue', () => {
  const marksFor = (i: any) => {
    const v = nextActionView(i)
    return { key: v.key, snapshot: v.snapshot, pending: null as any }
  }
  const steady = input({ agents: [agent()], plan: plan({ running: [item('a', '>')] }) })
  const withCard = { ...steady, cards: [card(3)] }

  test('a change waits one stable tick', () => {
    const marks = marksFor(steady)

    const first = nextActionDue(marks, nextActionView(withCard), NOW)
    const second = nextActionDue({ ...marks, pending: first.pending }, nextActionView(withCard), NOW + 15_000)

    expect([first.due, second.due]).toEqual([false, true])
  })

  test('a burst of changes in one window sends once', () => {
    const marks = marksFor(steady)
    const burst = { ...steady, plan: plan({ running: [item('a', '>')], waits: [item('x', '?'), item('y', '?'), item('z', '?')] }) }

    const first = nextActionDue(marks, nextActionView(burst), NOW)
    const second = nextActionDue({ ...marks, pending: first.pending }, nextActionView(burst), NOW + 15_000)
    const third = nextActionDue(marksFor(burst), nextActionView(burst), NOW + 30_000)

    expect([first.due, second.due, third.due]).toEqual([false, true, false])
  })

  test('a key that keeps changing sends after 60 s', () => {
    const marks = marksFor(steady)
    const cardsOf = (n: number) => ({ ...steady, cards: Array.from({ length: n }, (_, i) => card(3 + i)) })
    let pending: any = null
    const dueAt: boolean[] = []

    for (let tick = 0; tick <= 4; tick++) {
      const r = nextActionDue({ ...marks, pending }, nextActionView(cardsOf(tick + 1)), NOW + tick * 15_000)
      pending = r.pending
      dueAt.push(r.due)
    }

    expect(dueAt).toEqual([false, false, false, false, true])
  })

  test('an urgent change sends at the next tick', () => {
    const marks = marksFor(steady)
    const urgent = { ...steady, cards: [card(3, { urgent: true })] }

    expect(nextActionDue(marks, nextActionView(urgent), NOW).due).toBe(true)
  })

  test('a blocked worker and a fresh denial send at the next tick', () => {
    const marks = marksFor(steady)
    const blocked = { ...steady, agents: [agent({ state: 'blocked' })] }
    const denied = { ...steady, denials: [{ name: 'app-1-tester', tool: 'Bash', at: NOW }] }

    expect(nextActionDue(marks, nextActionView(blocked), NOW).due).toBe(true)
    expect(nextActionDue(marks, nextActionView(denied), NOW).due).toBe(true)
  })

  test('an unchanged key sends nothing', () => {
    const marks = marksFor(withCard)

    expect(nextActionDue(marks, nextActionView(withCard), NOW + 120_000)).toEqual({ due: false, pending: null })
  })

  test('a step done, a new [?] item and a stall each send, though the block text is the same', () => {
    const running = { ...steady, plan: plan({ running: [item('a', '>')], next: [item('d')] }) }
    const stepDone = { ...running, plan: plan({ done: [item('a', 'x')], next: [item('d')] }) }
    const asked = { ...withCard, plan: plan({ waits: [item('answer Q-3 (orch)', '?')] }) }
    const stalled = { ...withCard, stalled: true }
    const cases = [[running, stepDone], [withCard, asked], [withCard, stalled]]

    for (const [before, after] of cases) {
      expect(nextActionBlock(after)).toBe(nextActionBlock(before))
      const marks = marksFor(before)
      const first = nextActionDue(marks, nextActionView(after), NOW)
      const second = nextActionDue({ ...marks, pending: first.pending }, nextActionView(after), NOW + 15_000)
      expect([first.due, second.due]).toEqual([false, true])
    }
  })

  test('a card that closes after such a send sends nothing: no trigger is left over', () => {
    const asked = { ...withCard, plan: plan({ waits: [item('manual test (tester)', '?')] }) }
    const closed = { ...asked, cards: [card(3, { status: 'answered', decision: 1 })] }
    const marks = marksFor(asked)

    expect(nextActionDue(marks, nextActionView(closed), NOW + 120_000)).toEqual({ due: false, pending: null })
  })

  test('a changed key without a trigger sends nothing: a closed card alone', () => {
    const marks = marksFor(withCard)
    const closed = { ...steady, cards: [card(3, { status: 'answered', decision: 1 })] }

    expect(nextActionView(closed).key).not.toBe(marks.key)
    expect(nextActionDue(marks, nextActionView(closed), NOW + 120_000).due).toBe(false)
  })
})

describe('draftHeld', () => {
  test('no draft holds nothing and keeps no mark', () => {
    expect(draftHeld(null, '')).toEqual({ mark: null, held: false })
  })

  test('a draft seen for the first time holds the message', () => {
    expect(draftHeld(null, 'half a sent')).toEqual({ mark: { text: 'half a sent', still: 0 }, held: true })
  })

  test('a draft that changed since the last tick starts over', () => {
    expect(draftHeld({ text: 'half', still: 1 }, 'half a sent')).toEqual({ mark: { text: 'half a sent', still: 0 }, held: true })
  })

  test('a draft unchanged for two ticks is left behind: the message goes ahead', () => {
    expect(draftHeld({ text: 'half', still: 0 }, 'half').held).toBe(true)
    expect(draftHeld({ text: 'half', still: 1 }, 'half')).toEqual({ mark: { text: 'half', still: 2 }, held: false })
  })
})

describe('nextActionPrompt', () => {
  test('the header asks for every fact in own words, names the four facts, says always reply and never drop a fact, takes run facts from the block, the changes or a queue read only, allows queue and no other tool; block and change list follow', () => {
    const prompt = nextActionPrompt('BLOCK', ['New card: Q? (Q-3)', 'Step done: a (impl)'])

    expect(prompt).toBe([
      'NEXT-ACTION from the team mod. Tell the human every fact in the block below, in your own words: ' +
        'where the run stands, what waits on them with its card id, what runs now with time spent, ' +
        'what comes next. You may reorder and merge, add context from the changes listed, and link it to ' +
        'the topic you and the human just discussed. Always reply; never drop a fact. ' +
        'Every run fact you tell comes from the block, the change list or a queue read; ' +
        'never add a run fact from elsewhere, and mark a guess as a guess. ' +
        'You may call queue. Call no other tool.',
      '---',
      'BLOCK',
      '---',
      'Changes since the last message:',
      '- New card: Q? (Q-3)',
      '- Step done: a (impl)',
    ].join('\n'))
  })
})

describe('in the envoy session', () => {
  const ticks = async (w: any, n: number) => {
    for (let i = 0; i < n; i++) await w.clock.advance(15000)
  }
  const pushes = (w: any): string[] => w.submits.filter((s: string) => s.startsWith('NEXT-ACTION'))
  const ORCH = { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }
  const scout = (state = 'idle') => ({ pane_id: 'w1:p2', agent_status: state, agent_session: { value: 'sid-scout' } })
  const writePlan = (w: any, body: string) => w.write(`${w.cwd}/scratchpad/current/progress-APP-1.md`, `# APP-1\n${body}`)
  const turn = { text: 'what now?', turnId: 't1' } as never
  const turnEnd = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never

  /** An envoy session whose orchestrator and scout idle in herdr, one tick past its baseline. */
  const quiet = async ($: any, on: any) => {
    const w = await envoyTeam($, on)
    w.agents = [ORCH, scout()]
    await ticks(w, 1)
    return w
  }

  test('a new open card submits one NEXT-ACTION prompt after one quiet tick', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3)

    await ticks(w, 1)
    expect(pushes(w)).toEqual([])
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain(
      'Next for you: Answer: Use real fixtures or the snapshot? (Q-3, from the investigator (w1:p2))')
    expect(pushes(w)[0]).toContain(
      '- New card: Use real fixtures or the snapshot? (Q-3, from the investigator (w1:p2))')
    await ticks(w, 3)
    expect(pushes(w)).toHaveLength(1)
  })

  test('three plan steps flipped within one tick send one message', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [ORCH, scout()]
    writePlan(w, '## RUNNING\n- [>] step a\n- [>] step b\n- [>] step c\n## NEXT\n- [ ] step d\n')
    await ticks(w, 1)

    writePlan(w, '## DONE\n- [x] step a\n- [x] step b\n- [x] step c\n## NEXT\n- [ ] step d\n')
    await ticks(w, 5)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Step done: step a\n- Step done: step b\n- Step done: step c')
  })

  /** An envoy session where the scout works on a brief, one tick past its baseline. */
  const working = async ($: any, on: any, plan: string) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, {
      role: 'investigator', topic: 'fixtures', brief: 'brief-app-1-scout-fixtures.md', pane: 'w1:p2', session: 'sid-scout',
    })
    w.write(`${w.cwd}/scratchpad/current/brief-app-1-scout-fixtures.md`, 'brief')
    w.agents = [ORCH, scout('working')]
    writePlan(w, plan)
    await ticks(w, 1)
    return w
  }

  test('a step done sends one message although the block text stays the same', async ($, on) => {
    const w = await working($, on, '## RUNNING\n- [>] step a\n## NEXT\n- [ ] step d\n')

    writePlan(w, '## DONE\n- [x] step a\n## NEXT\n- [ ] step d\n')
    await ticks(w, 4)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Step done: step a')
    expect(pushes(w)[0]).toContain('Running now: the investigator (w1:p2) on fixtures')
  })

  test('a new [?] item sends one message while another card is open; the card closing after it sends nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [ORCH, scout()]
    fileCard(w, 3)
    await ticks(w, 1)

    writePlan(w, '## WAITS ON YOU\n- [?] manual test (tester)\n')
    await ticks(w, 4)
    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Step waits on you: manual test (tester)')
    expect(pushes(w)[0]).toContain('Blocked on you: 2 things wait.')
    expect(pushes(w)[0]).toContain('Also waits in the plan: manual test (tester)')

    fileCard(w, 3, { status: 'answered', decision: 1 })
    await ticks(w, 6)

    expect(pushes(w)).toHaveLength(1)
  })

  test('a card from the orchestrator is named by role and pane, and the orchestrator is not a running agent', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/app-1-orch.json`, {
      role: 'orchestrator', topic: '', brief: '', pane: 'w1:p1', session: 'sid-orch-worker',
    })
    w.agents = [{ ...ORCH, agent_status: 'working' }, scout()]
    await ticks(w, 1)

    fileCard(w, 3, { from: 'app-1-orch', question: 'Keep the old parser API?' })
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('Next for you: Answer: Keep the old parser API? (Q-3, from the orchestrator (w1:p1))')
    expect(pushes(w)[0]).toContain('- New card: Keep the old parser API? (Q-3, from the orchestrator (w1:p1))')
    expect(pushes(w)[0]).toContain('Running now: nothing')
    expect(pushes(w)[0]).not.toContain('Agent started')
  })

  test('a card from an orchestrator whose record is gone is named by its filer', async ($, on) => {
    const w = await quiet($, on)

    fileCard(w, 3, { from: 'app-1-orch' })
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('(Q-3, from app-1-orch)')
  })

  test('later ticks with no change submit nothing, minutes spent included', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, {
      role: 'investigator', topic: 'fixtures', brief: 'brief-app-1-scout-fixtures.md', pane: 'w1:p2', session: 'sid-scout',
    })
    w.write(`${w.cwd}/scratchpad/current/brief-app-1-scout-fixtures.md`, 'brief')
    w.agents = [ORCH, scout('working')]

    await ticks(w, 12)

    expect(pushes(w)).toEqual([])
    expect(w.json(`${w.team}/next-action.json`).key).toContain('Running now: the investigator (w1:p2) on fixtures\n')
  })

  test('the first tick of the envoy role is a baseline: no prompt', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [ORCH, scout()]
    fileCard(w, 3)

    await ticks(w, 4)

    expect(pushes(w)).toEqual([])
    expect(w.json(`${w.team}/next-action.json`)).toMatchObject({ pending: null, snapshot: { open: ['Q-3'] } })
  })

  test('a queue call counts as shown: the same state is not pushed', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3)
    await ticks(w, 1)

    await call($, 'queue', {})
    await ticks(w, 4)

    expect(pushes(w)).toEqual([])
  })

  test('no prompt while the envoy turn runs; it goes at the first idle tick, with fresh text', async ($, on) => {
    const w = await quiet($, on)
    await $.turn.start(turn)
    fileCard(w, 3)
    await ticks(w, 3)
    fileCard(w, 4)
    await ticks(w, 1)
    expect(pushes(w)).toEqual([])

    await $.turn.complete(turnEnd)
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('(Q-3, from the investigator (w1:p2)). 1 more: Q-4.')
  })

  test('no prompt while a decide call runs in the envoy turn', async ($, on) => {
    const w = await quiet($, on)
    w.write(`${w.cwd}/scratchpad/current/decisions-APP-1.md`, '# Decisions APP-1\n')
    fileCard(w, 3)
    fileCard(w, 4)
    await ticks(w, 1)
    await $.turn.start(turn)

    await call($, 'decide', { cards: ['Q-3'], answer: 'Use real fixtures.', rationale: 'It hides the bug.' })
    await ticks(w, 3)
    expect(pushes(w)).toEqual([])
    await $.turn.complete(turnEnd)
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('(Q-4, from the investigator (w1:p2))')
    expect(pushes(w)[0]).not.toContain('Q-3')
  })

  test('a turn that never completes does not hold the message for good', async ($, on) => {
    const w = await quiet($, on)
    await $.turn.start(turn)
    fileCard(w, 3)
    await ticks(w, 3)
    expect(pushes(w)).toEqual([])

    await w.clock.advance(10 * 60_000)

    expect(pushes(w)).toHaveLength(1)
  })

  test('a subagent turn that completes does not end the envoy turn', async ($, on) => {
    const w = await quiet($, on)
    await $.turn.start(turn)
    fileCard(w, 3)

    await $.turn.complete({ ...(turnEnd as object), turnId: 'sub-1', agentId: 'agent-7' } as never)
    await ticks(w, 4)

    expect(pushes(w)).toEqual([])
  })

  test('a draft that changed since the last tick holds the prompt; a draft left 30 s goes ahead', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3)
    w.draft = 'half a sent'

    await ticks(w, 2)
    expect(pushes(w)).toEqual([])
    w.draft = 'half a sentence'
    await ticks(w, 2)
    expect(pushes(w)).toEqual([])
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
  })

  test('a blocked worker sends at the next tick, without the quiet wait', async ($, on) => {
    const w = await quiet($, on)
    w.agents = [ORCH, scout('blocked')]

    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain(
      `Next for you: Allow or deny a permission prompt in the investigator's pane (w1:p2): ${DIALOG_TEXT}`)
    expect(pushes(w)[0]).toContain('- The investigator (w1:p2) is blocked on a permission prompt')
  })

  test('a fresh denial mark sends a NEXT-ACTION prompt at the next tick', async ($, on) => {
    const w = await quiet($, on)

    w.writeJson(`${w.team}/denials/app-1-scout.json`, { tool: 'mcp__gitlab__save_note', reason: 'auto mode', at: w.clock.now() })
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain(
      '- Auto mode denied the investigator (w1:p2) a tool call: mcp__gitlab__save_note')
  })

  test('a gone orchestrator sends at the next tick', async ($, on) => {
    const w = await quiet($, on)
    w.agents = [scout()]

    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('Orchestrator gone: run /team-envoy to start a new one.')
  })

  test('a reload does not resend: the marks are in next-action.json', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3)
    await ticks(w, 2)
    expect(pushes(w)).toHaveLength(1)

    await start($)
    await ticks(w, 4)

    expect(pushes(w)).toHaveLength(1)
  })

  test('the orchestrator session submits no NEXT-ACTION prompt', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.agents = [ORCH, scout()]
    await ticks(w, 1)
    fileCard(w, 3)

    await ticks(w, 5)

    expect(pushes(w)).toEqual([])
    expect(w.files.has(`${w.team}/next-action.json`)).toBe(false)
  })

  test('a session with both roles submits no NEXT-ACTION prompt', async ($, on) => {
    const w = await team($, on)
    await ticks(w, 1)
    fileCard(w, 3)

    await ticks(w, 5)

    expect(pushes(w)).toEqual([])
    expect(w.files.has(`${w.team}/next-action.json`)).toBe(false)
  })

  test('a parked card alone sends nothing; it shows in the next message\'s change list', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3, { status: 'assumed', question: 'Show time spent or an ETA?' })

    await ticks(w, 4)
    expect(pushes(w)).toEqual([])
    fileCard(w, 4)
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Parked card filed: Show time spent or an ETA? (Q-3)')
  })

  test('a rejected submit is tried again at the next tick', async ($, on) => {
    const w = await quiet($, on)
    fileCard(w, 3)
    await ticks(w, 1)
    w.submitFails = true

    await ticks(w, 1)
    expect(pushes(w)).toEqual([])
    await ticks(w, 1)

    expect(pushes(w)).toHaveLength(1)
  })

  test('next-action.json is no agent record', async ($, on) => {
    const w = await quiet($, on)
    expect(w.files.has(`${w.team}/next-action.json`)).toBe(true)
    await ticks(w, 1)

    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)

    expect(await ui.find({ type: 'Button', text: /next-action/ })).toBeUndefined()
  })
})
