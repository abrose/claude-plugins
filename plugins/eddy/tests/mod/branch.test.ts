import { describe, expect, test } from 'claude-code/testing'
import { switchBranch } from '../../hooks/mod/branches'
import type { BranchHomes } from '../../hooks/mod/branches'
import { pushNextAction } from '../../hooks/mod/next-action-push'
import { call, card as fileCard, CARD, envoyTeam, start, world } from './world'

const TICK = 15000
const ticks = async (w: any, n: number) => {
  for (let i = 0; i < n; i++) await w.clock.advance(TICK)
}
const pushes = (w: any): string[] => w.submits.filter((s: string) => s.startsWith('NEXT-ACTION'))
const ORCH = { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }
const scout = (state = 'idle') => ({ pane_id: 'w1:p2', agent_status: state, agent_session: { value: 'sid-scout' } })
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
const branchPath = (w: { team: string }, id = 'B-1') => `${w.team}/branches/${id}.json`

/** An envoy session with the orchestrator and the scout idle in herdr and card Q-3 open, one tick past its baseline. */
async function envoyWithCard($: any, on: any) {
  const w = await envoyTeam($, on)
  w.agents = [ORCH, scout()]
  fileCard(w, 3)
  await ticks(w, 1)
  return w
}

/** The same, with a fold branch B-1 open on Q-3. */
async function openFold($: any, on: any) {
  const w = await envoyWithCard($, on)
  const r = await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
  expect(r.isError).toBeUndefined()
  return w
}

/** Writes a branch record as the mod would, with the given fields over a fold branch on Q-3. */
const record = (w: any, fields: object = {}) =>
  w.writeJson(branchPath(w), {
    id: 'B-1', n: 1, card: 'Q-3', seed: {}, mode: 'fold', owner: w.id, envoy: w.id, state: 'open',
    mark: 'EDDY-BRANCH-OPEN B-1 on Q-3', opened_by: '', base: 0, history: [],
    note: { leaning: '', own_options: [], open_points: [] }, agents: [],
    log: [{ from: 'none', to: 'fold', at: 1 }], opened_at: 1, ...fields,
  })

describe('branch_open', () => {
  test('branch_open writes B-1 with the card seed, fold mode and the envoy as owner', async ($, on) => {
    const w = await envoyWithCard($, on)
    const r = await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })

    expect(r.isError).toBeUndefined()
    expect(w.json(branchPath(w))).toMatchObject({
      id: 'B-1', n: 1, card: 'Q-3', mode: 'fold', owner: w.id, envoy: w.id, state: 'open',
      mark: 'EDDY-BRANCH-OPEN B-1 on Q-3', base: 0, history: [], agents: [],
      note: { leaning: '', own_options: [], open_points: [] },
      log: [{ from: 'none', to: 'fold' }],
      seed: {
        question: CARD.question, context: CARD.context, recommendation: CARD.recommendation,
        blocks: CARD.blocks, door: 'two-way', rework: CARD.rework,
      },
    })
  })

  test('branch_open puts the marker line first in its result', async ($, on) => {
    await envoyWithCard($, on)
    const r = await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })

    expect(r.result.split('\n')).toEqual([
      'EDDY-BRANCH-OPEN B-1 on Q-3',
      'The branch is open here. News waits until you close it.',
    ])
  })

  test('branch_open keeps the opening prompt as the fold pick point', async ($, on) => {
    const w = await envoyWithCard($, on)
    const opening = `let us talk about the fixtures question ${'x'.repeat(60)}`
    w.messages = [
      { role: 'user', text: 'older prompt', toolUses: [] },
      { role: 'user', text: opening, toolUses: [] },
      { role: 'assistant', text: 'sure', toolUses: [] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't0', text: 'result', isError: false }] },
      { role: 'user', text: 'NEXT-ACTION from the eddy mod. Tell the human only what changed', toolUses: [] },
    ]
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })

    expect(w.json(branchPath(w)).opened_by).toBe(opening.slice(0, 60))
  })

  test('branch_open refuses outside the envoy session', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
      orchestrator_session: w.id, envoy_session: 'sid-other-envoy',
    })
    fileCard(w, 3)
    const r = await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })

    expect(r).toMatchObject({ isError: true, result: 'branch_open works only in the envoy session' })
    expect(w.files.has(branchPath(w))).toBe(false)
  })

  test('branch_open refuses a second open branch', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4)
    const r = await call($, 'branch_open', { card: 'Q-4', mode: 'fold' })

    expect(r.isError).toBe(true)
    expect(r.result).toContain('B-1')
    expect(w.files.has(branchPath(w, 'B-2'))).toBe(false)
  })

  test('two parallel branch_open calls leave exactly one open branch', async ($, on) => {
    const w = await envoyWithCard($, on)
    fileCard(w, 4)
    const [a, b] = await Promise.all([
      call($, 'branch_open', { card: 'Q-3', mode: 'fold' }),
      call($, 'branch_open', { card: 'Q-4', mode: 'fold' }),
    ])

    expect([a, b].filter(r => r.isError).length).toBe(1)
    const opened = [...w.files.keys()].filter(p => /\/branches\/B-\d+\.json$/.test(p))
      .filter(p => w.json(p).state === 'open')
    expect(opened).toHaveLength(1)
    const refused = [a, b].find(r => r.isError)!
    expect(refused.result).toContain(w.json(opened[0]!).id)
  })

  test('branch_open refuses a card that is answered or obsolete', async ($, on) => {
    const w = await envoyWithCard($, on)
    fileCard(w, 4, { status: 'answered', decision: 1 })
    fileCard(w, 5, { status: 'obsolete' })

    for (const id of ['Q-4', 'Q-5', 'Q-9']) {
      const r = await call($, 'branch_open', { card: id, mode: 'fold' })
      expect(r.isError).toBe(true)
      expect(r.result).toContain(id)
    }
    expect([...w.files.keys()].filter(p => p.includes('/branches/B-'))).toEqual([])
  })

  test('branch_open in pane mode answers not built yet', async ($, on) => {
    const w = await envoyWithCard($, on)
    const r = await call($, 'branch_open', { card: 'Q-3', mode: 'pane' })

    expect(r).toMatchObject({ isError: true })
    expect(r.result).toContain('pane mode not built yet')
    expect([...w.files.keys()].filter(p => p.includes('/branches/B-'))).toEqual([])
  })
})

describe('branch ownership', () => {
  test('branch_note from a session that is not the owner refuses and names the mode', async ($, on) => {
    const w = await openFold($, on)
    const ok = await call($, 'branch_note', { id: 'B-1', leaning: 'real fixtures', open_points: ['cost of the loader'] })
    expect(ok.isError).toBeUndefined()
    expect(w.json(branchPath(w)).note).toMatchObject({ leaning: 'real fixtures', open_points: ['cost of the loader'] })

    record(w, { mode: 'pane', owner: 'sid-discussant' })
    const r = await call($, 'branch_note', { id: 'B-1', leaning: 'snapshot' })

    expect(r.isError).toBe(true)
    expect(r.result).toContain('pane')
    expect(w.json(branchPath(w)).note.leaning).toBe('')
  })

  test('branch_mode refuses a caller that is neither the envoy nor the owner', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
      orchestrator_session: w.id, envoy_session: 'sid-other-envoy',
    })
    record(w, { owner: 'sid-discussant', envoy: 'sid-other-envoy' })
    const r = await call($, 'branch_mode', { id: 'B-1', mode: 'pane' })

    expect(r.isError).toBe(true)
    expect(r.result).toContain('only the envoy or its owner')
    expect(w.json(branchPath(w)).mode).toBe('fold')
  })
})

describe('switchBranch', () => {
  /** An Io over a map: switchBranch reads and writes the branch record and nothing else. */
  const fakeIo = (files: Map<string, string>) => ({
    envGet: async () => '/run',
    readText: async (p: string) => files.get(p) ?? null,
    writeText: async (p: string, t: string) => void files.set(p, t),
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    now: async () => 5000,
  }) as never
  const PATH = '/run/.eddy/branches/B-1.json'
  const seeded = () => {
    const files = new Map<string, string>()
    files.set(PATH, JSON.stringify({
      id: 'B-1', n: 1, card: 'Q-3', mode: 'fold', owner: 'sid-envoy', envoy: 'sid-envoy', state: 'open',
      mark: 'EDDY-BRANCH-OPEN B-1 on Q-3', base: 0, history: [], agents: [],
      log: [{ from: 'none', to: 'fold', at: 1 }],
    }))
    return files
  }
  const ENVOY = { session: 'sid-envoy', envoy: true }
  const ROWS = [{ role: 'human' as const, text: 'what about cost?', at: 2 }]

  test('switchBranch with fake homes runs busy, collect, enter, leave in order and logs the switch', async () => {
    const files = seeded()
    const order: string[] = []
    const homes: BranchHomes = {
      fold: {
        busy: async () => void order.push('fold.busy') ?? null,
        collect: async () => void order.push('fold.collect') ?? ROWS,
        enter: async () => ({ owner: 'sid-envoy', text: 'back in the chat' }),
        leave: async () => void order.push('fold.leave') ?? null,
      },
      pane: {
        busy: async () => null,
        collect: async () => [],
        enter: async () => void order.push('pane.enter') ?? { owner: 'sid-discussant', text: 'moved to w1:p9' },
        leave: async () => null,
      },
    }
    const r = await switchBranch(fakeIo(files), 'B-1', 'pane', ENVOY, homes)

    expect(r).toEqual({ text: 'moved to w1:p9' })
    expect(order).toEqual(['fold.busy', 'fold.collect', 'pane.enter', 'fold.leave'])
    const rec = JSON.parse(files.get(PATH)!)
    expect(rec).toMatchObject({ mode: 'pane', owner: 'sid-discussant', history: ROWS, base: 1 })
    expect(rec.log).toEqual([{ from: 'none', to: 'fold', at: 1 }, { from: 'fold', to: 'pane', at: 5000 }])
  })

  test('switchBranch puts the record back when enter refuses', async () => {
    const files = seeded()
    const before = files.get(PATH)
    const left: string[] = []
    const homes: BranchHomes = {
      fold: {
        busy: async () => null,
        collect: async () => ROWS,
        enter: async () => ({ owner: 'sid-envoy', text: 'x' }),
        leave: async () => void left.push('fold.leave') ?? null,
      },
      pane: {
        busy: async () => null,
        collect: async () => [],
        enter: async () => ({ refused: 'herdr is down' }),
        leave: async () => null,
      },
    }
    const r = await switchBranch(fakeIo(files), 'B-1', 'pane', ENVOY, homes)

    expect(r).toEqual({ refused: 'herdr is down' })
    expect(JSON.parse(files.get(PATH)!)).toEqual(JSON.parse(before!))
    expect(left).toEqual([])
  })

  test('switchBranch puts the record back when enter throws', async () => {
    const files = seeded()
    const before = files.get(PATH)
    const left: string[] = []
    const homes: BranchHomes = {
      fold: {
        busy: async () => null,
        collect: async () => ROWS,
        enter: async () => ({ owner: 'sid-envoy', text: 'x' }),
        leave: async () => void left.push('fold.leave') ?? null,
      },
      pane: {
        busy: async () => null,
        collect: async () => [],
        enter: async () => {
          throw new Error('herdr crashed')
        },
        leave: async () => null,
      },
    }
    const r = await switchBranch(fakeIo(files), 'B-1', 'pane', ENVOY, homes)

    expect(r).toMatchObject({ refused: expect.stringContaining('herdr crashed') })
    expect(JSON.parse(files.get(PATH)!)).toEqual(JSON.parse(before!))
    expect(left).toEqual([])
  })
})

describe('branch_close', () => {
  test('branch_close settled refuses while the card is still open', async ($, on) => {
    const w = await openFold($, on)
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'we take real fixtures' })

    expect(r.isError).toBe(true)
    expect(r.result).toContain('decide')
    expect(r.result).toContain('Q-3')
    expect(w.json(branchPath(w)).state).toBe('open')
  })

  test('branch_close settled returns the return line with the decision number', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 3, { status: 'answered', decision: 4 })
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'we take real fixtures' })

    expect(r.isError).toBeUndefined()
    expect(r.result).toContain(
      'Back from the branch on Use real fixtures or the snapshot? (Q-3): we take real fixtures. Recorded as decision 4.')
    expect(w.json(branchPath(w))).toMatchObject({ state: 'settled', summary: 'we take real fixtures', decision: 4 })
    expect(w.json(branchPath(w)).closed_at).toBeGreaterThan(0)
  })
})

describe('the hold of news while a branch is open', () => {
  test('an open branch holds a two-way card that blocks one agent', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4, { door: 'two-way', blocks: 'one agent', urgent: false })
    await ticks(w, 8)

    expect(pushes(w)).toEqual([])
  })

  test('a permission prompt passes an open branch', async ($, on) => {
    const w = await openFold($, on)
    w.agents = [ORCH, scout('blocked')]
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('is blocked on a permission prompt')
  })

  test('a one-way-door card passes an open branch', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4, { door: 'one-way', urgent: false })
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('New card:')
    expect(pushes(w)[0]).toContain('Q-4')
  })

  // The source has no field that says a card blocks every running agent (open question 1 of the notes).
  // The stand-in is the urgent flag: the tool sets it for a card that blocks work a decision approved.
  test('a card that blocks every running agent passes an open branch', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4, { door: 'two-way', urgent: true })
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('Q-4, urgent')
  })

  test('the held changes go out in one message after branch_close', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4)
    await ticks(w, 4)
    expect(pushes(w)).toEqual([])

    fileCard(w, 3, { status: 'answered', decision: 1 })
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    expect(r.isError).toBeUndefined()
    await ticks(w, 2)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- New card:')
    expect(pushes(w)[0]).toContain('- Card answered:')
    await ticks(w, 4)
    expect(pushes(w)).toHaveLength(1)
  })

  test('a passing message carries only the passing news', async ($, on) => {
    const w = await openFold($, on)
    // The change list is the lines that start with "- "; the block above it also names every open card.
    const changes = (text: string) => text.split('\n').filter(l => l.startsWith('- '))
    fileCard(w, 4, { door: 'two-way', urgent: false })
    fileCard(w, 5, { door: 'one-way', urgent: false })
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(changes(pushes(w)[0]).join('\n')).toContain('Q-5')
    expect(changes(pushes(w)[0]).join('\n')).not.toContain('Q-4')

    fileCard(w, 3, { status: 'answered', decision: 1 })
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    expect(r.isError).toBeUndefined()
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(2)
    const after = changes(pushes(w)[1]).join('\n')
    expect(after).toContain('New card:')
    expect(after).toContain('Q-4')
    expect(after).not.toContain('Q-5')
    await ticks(w, 4)
    expect(pushes(w)).toHaveLength(2)
  })

  test('a passing message names no held card', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4, { door: 'two-way', urgent: false })
    fileCard(w, 5, { door: 'one-way', urgent: false })
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    const text = pushes(w)[0]!
    expect(text).toContain('Q-5')
    expect(text).not.toContain('Q-4')
    expect(text).not.toContain('2 more')

    fileCard(w, 3, { status: 'answered', decision: 1 })
    await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    await ticks(w, 3)
    expect(pushes(w)).toHaveLength(2)
    expect(pushes(w)[1]).toContain('Q-4')
  })

  test('a queue call during a branch keeps the held news due', async ($, on) => {
    const w = await openFold($, on)
    // A denial waits behind the branch (decision 26 literal); a two-way card waits too.
    w.writeJson(`${w.team}/denials/app-1-scout.json`, { tool: 'Bash', reason: 'rm -rf', at: w.clock.now() })
    fileCard(w, 4)
    await ticks(w, 3)
    expect(pushes(w)).toEqual([])

    const shown = await call($, 'queue', {})
    expect(shown.isError).toBeUndefined()
    await ticks(w, 3)
    expect(pushes(w)).toEqual([])

    fileCard(w, 3, { status: 'answered', decision: 1 })
    await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('Auto mode denied')
    // The queue call showed Q-4 to the envoy: it is not told as new again.
    expect(pushes(w)[0]).not.toContain('New card:')
  })

  test('a denial and an orchestrator gone wait behind an open branch', async ($, on) => {
    const w = await openFold($, on)
    w.writeJson(`${w.team}/denials/app-1-scout.json`, { tool: 'Bash', reason: 'rm -rf', at: w.clock.now() })
    w.agents = [scout()]
    await ticks(w, 6)
    expect(pushes(w)).toEqual([])

    fileCard(w, 3, { status: 'answered', decision: 1 })
    await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('Auto mode denied')
    expect(pushes(w)[0]).toContain('The orchestrator is gone')
  })

  test('branch_close dropped lifts the hold', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4)
    await ticks(w, 4)
    expect(pushes(w)).toEqual([])

    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'dropped' })
    expect(r.isError).toBeUndefined()
    expect(w.json(branchPath(w)).state).toBe('dropped')
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- New card:')
    expect(pushes(w)[0]).toContain('Q-4')
  })

  test('the status line shows the branch and the news that wait', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4)
    await ticks(w, 4)

    expect(w.statuses.at(-1)).toBe('branch open on Q-3 (B-1, fold) · 1 news wait')
  })

  // A second source of holds (a later delivery mode) cannot be added from a test: the engine loads the hooks
  // module in its own copy. So this test drives the gate, `pushNextAction`, with two holds in the input.
  test('the gate holds while any of two holds is in force and sends once after both lift', async () => {
    const files = new Map<string, string>()
    const submits: string[] = []
    const io = {
      readText: async (p: string) => files.get(p) ?? null,
      writeText: async (p: string, t: string) => void files.set(p, t),
      rename: async (from: string, to: string) => {
        files.set(to, files.get(from)!)
        files.delete(from)
      },
      draft: async () => '',
      submit: async (text: string) => void submits.push(text),
    } as never
    const BRANCH = { by: 'branch', card: 'Q-3', label: 'branch open on Q-3 (B-1, fold)' }
    const FOCUS = { by: 'focus', label: 'a pinned card' }
    const q4 = { ...CARD, id: 'Q-4', n: 4, from: 'app-1-scout', tag: 'general', urgent: false, refs: [], status: 'open', at: 1 }
    const input = (holds: object[], cards: object[], now: number) => ({
      cards, plan: null, agents: [], filers: [], orchestratorGone: false, stalled: false, denials: [], holds, now,
    }) as never
    const send = (holds: object[], now: number) => pushNextAction(io, '/run/.eddy', input(holds, [q4], now))

    await pushNextAction(io, '/run/.eddy', input([], [], 0))
    await send([BRANCH, FOCUS], 15000)
    await send([BRANCH, FOCUS], 30000)
    expect(submits).toEqual([])
    const waiting = await send([BRANCH, FOCUS], 45000)
    expect(waiting).toBe(1)

    await send([FOCUS], 60000)
    await send([FOCUS], 75000)
    expect(submits).toEqual([])

    await send([], 90000)
    await send([], 105000)
    expect(submits).toHaveLength(1)
    expect(submits[0]).toContain('- New card:')
    await send([], 120000)
    expect(submits).toHaveLength(1)
  })
})

describe('the Questions pane and the compact rule', () => {
  test('the Questions pane marks the card in discussion with its mode', async ($, on) => {
    const w = await openFold($, on)
    fileCard(w, 4)
    await ticks(w, 1)
    const ui = await $.ui.mount({
      plugin: 'eddy', surface: 'terminal', component: 'Pane', requestId: 'eddy-questions', props: { bodyColumns: 120 },
    } as never)
    const rows: string[] = (await ui.findAll({ type: 'Button', text: /^[▸▾] / })).map((b: any) => b.text.replace(/\s+/g, ' '))

    expect(rows.find(r => r.includes('Q-3'))).toContain('in discussion (fold)')
    expect(rows.find(r => r.includes('Q-4'))).not.toContain('in discussion')
  })

  test('a manual compact while a branch is open is skipped with the reason', async ($, on) => {
    // The engine's bottom of a compaction. It lives here, not in world.ts: reset.test.ts registers its own.
    const reached: string[] = []
    on('session.compact', (_$, e) => {
      reached.push(e.trigger)
      return { messages: e.messages }
    })
    await openFold($, on)

    for (const trigger of ['manual', 'plugin']) {
      const done = await $.session.compact({ trigger, messages: MESSAGES } as never)
      expect(done.skip).toContain('An eddy branch is open (B-1 on Q-3)')
    }
    expect(reached).toEqual([])
    // An auto compact is not vetoed: a veto there could stall the envoy.
    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    expect(reached).toEqual(['auto'])
  })
})
