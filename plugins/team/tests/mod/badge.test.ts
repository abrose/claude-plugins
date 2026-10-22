import { describe, expect, test } from 'claude-code/testing'
import {
  badgeText, freshStall, freshUrgent, pickStatus, stallIds, stallText, TOAST_MS, toastText,
} from '../../hooks/mod/badge'
import { card, envoyTeam, start, team } from './world'

const c = (n: number, more: object = {}) =>
  ({ id: `Q-${n}`, n, from: 'app-1-tester', question: 'Approve rm -rf build?', status: 'open', urgent: true, ...more }) as any

describe('badgeText', () => {
  test('counts unresolved urgent cards and names the oldest', () => {
    expect(badgeText([c(4), c(3, { status: 'assumed' }), c(2, { status: 'answered' }), c(1, { urgent: false })]))
      .toBe('2 urgent: Q-3 app-1-tester: Approve rm -rf build?')
  })
  test('no urgent card clears the badge', () => {
    expect(badgeText([c(1, { urgent: false })])).toBeUndefined()
  })
  test('an obsolete urgent card is resolved', () => {
    expect(badgeText([c(1, { status: 'obsolete' })])).toBeUndefined()
  })
  test('no card at all clears the badge', () => {
    expect(badgeText([])).toBeUndefined()
  })
})

describe('toastText', () => {
  test('names the card, its sender and its question', () => {
    expect(toastText(c(3))).toBe('URGENT Q-3 app-1-tester: Approve rm -rf build?')
  })
})

describe('TOAST_MS', () => {
  test('is 30 seconds', () => {
    expect(TOAST_MS).toBe(30_000)
  })
})

describe('freshUrgent', () => {
  test('no marks yet is a baseline', () => {
    expect(freshUrgent([c(1)], null)).toEqual({ toast: [], seen: ['Q-1'] })
  })
  test('toasts a card once', () => {
    expect(freshUrgent([c(1), c(2)], ['Q-1']).toast.map(x => x.id)).toEqual(['Q-2'])
  })
  test('keeps the marks it had and adds the new ones', () => {
    expect(freshUrgent([c(1), c(2)], ['Q-1']).seen).toEqual(['Q-1', 'Q-2'])
  })
  test('a card that is not urgent is never toasted', () => {
    expect(freshUrgent([c(1, { urgent: false })], []).toast).toEqual([])
  })
  test('a resolved urgent card is marked but not toasted', () => {
    expect(freshUrgent([c(1, { status: 'answered' })], [])).toEqual({ toast: [], seen: ['Q-1'] })
  })
  test('toasts in card order', () => {
    expect(freshUrgent([c(3), c(2)], []).toast.map(x => x.id)).toEqual(['Q-2', 'Q-3'])
  })
})

describe('in the envoy session', () => {
  test('sets the status line, toasts each new urgent card once, starts no turn', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/toasted.json`, [])
    card(w, 3, { urgent: true, from: 'app-1-tester', question: 'Approve rm -rf build?' })
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBe('1 urgent: Q-3 app-1-tester: Approve rm -rf build?')
    expect(w.toasts).toEqual(['URGENT Q-3 app-1-tester: Approve rm -rf build?'])
    expect(w.submits).toEqual([])
  })

  test('the urgent toast stays 30 s', async ($, on) => {
    const w = await envoyTeam($, on)
    await w.clock.advance(15000)
    card(w, 4, { urgent: true })
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.toasts).toHaveLength(1)
    expect(w.toastMs).toEqual([30000])
  })

  test('clears the status line when the last urgent card closes', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    card(w, 3, { urgent: true, status: 'answered', decision: 1 })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('the orchestrator session sets no badge', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.statuses).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('the first tick without marks is a baseline: status set, nothing toasted, marks written', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^1 urgent: Q-3 /)
    expect(w.toasts).toEqual([])
    expect(w.json(`${w.team}/toasted.json`)).toEqual(['Q-3'])
  })

  test('an urgent card that arrives after the baseline is toasted once', async ($, on) => {
    const w = await envoyTeam($, on)
    await w.clock.advance(15000)
    card(w, 4, { urgent: true })
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.toasts).toEqual(['URGENT Q-4 app-1-scout: Use real fixtures or the snapshot?'])
    expect(w.json(`${w.team}/toasted.json`)).toEqual(['Q-4'])
  })

  test('the status line is set again only when its text changes', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    const after = w.statuses.length
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses.length).toBe(after)
  })

  test('a /clear in the envoy session does not toast again and sets the status line once more', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/toasted.json`, [])
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.toasts.length).toBe(1)
    const before = w.statuses.length
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-envoy-2'
    await start($)
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.toasts.length).toBe(1)
    expect(w.statuses.length).toBe(before + 1)
    expect(w.statuses.at(-1)).toMatch(/^1 urgent: Q-3 /)
    expect(w.json(`${w.team}/config.json`).envoy_session).toBe('sid-envoy-2')
  })

  test('losing the envoy role clears the status line once', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^1 urgent: Q-3 /)
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), envoy_session: 'sid-someone-else' })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBeUndefined()
    const after = w.statuses.length
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses.length).toBe(after)
  })

  test('a session that never held the envoy role sets no status line', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-stranger'
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses).toEqual([])
  })

  test('toasted.json is no agent record', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/toasted.json`, ['Q-1'])
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team', props: { bodyColumns: 80 } } as never)
    expect(await ui.find({ type: 'Button', text: /toasted/ })).toBeUndefined()
  })
})

describe('in a team without a separate envoy', () => {
  test('the orchestrator session holds both halves: it sets the status line', async ($, on) => {
    const w = await team($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^1 urgent: Q-3 /)
  })
})

describe('a prompt that was not sent, in the orchestrator session of a split team', () => {
  const failing = async ($: any, on: any) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`,
            '# Report\n\n---\n\nREPORT app-1-scout x: done\n')
    return w
  }

  test('shows in its own status line', async ($, on) => {
    const w = await failing($, on)
    w.submitFails = true
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^prompt not sent: /)
  })

  test('clears after the next good submit', async ($, on) => {
    const w = await failing($, on)
    w.submitFails = true
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^prompt not sent: /)
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('is set only when its text changes', async ($, on) => {
    const w = await failing($, on)
    w.submitFails = true
    await w.clock.advance(15000)
    const after = w.statuses.length
    expect(after).toBe(1)
    w.submitFails = true
    await w.clock.advance(15000)
    expect(w.statuses.length).toBe(after)
  })

  test('is cleared once when the session loses its role', async ($, on) => {
    const w = await failing($, on)
    w.submitFails = true
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toMatch(/^prompt not sent: /)
    w.writeJson(`${w.team}/config.json`, { ...w.json(`${w.team}/config.json`), orchestrator_session: 'sid-someone-else' })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBeUndefined()
    const after = w.statuses.length
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses.length).toBe(after)
  })

  test('a good submit with no error sets no status line', async ($, on) => {
    const w = await failing($, on)
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
    expect(w.statuses).toEqual([])
  })
})

const worker = (state: string, fresh = true) => ({ state, fresh })
const waiting = (over: object = {}) => ({
  cards: [c(1, { urgent: false })],
  herdrUp: true,
  workers: [worker('idle'), worker('done'), worker('gone')],
  orchestrator: 'idle' as string | undefined,
  ...over,
})

describe('stallIds', () => {
  test('open cards, an idle team and an idle orchestrator stall on the open ids, oldest first', () => {
    expect(stallIds(waiting({ cards: [c(5, { urgent: false }), c(2, { urgent: false })] }))).toEqual(['Q-2', 'Q-5'])
  })
  test('a team with no worker at all still stalls', () => {
    expect(stallIds(waiting({ workers: [] }))).toEqual(['Q-1'])
  })
  test('a done orchestrator counts as idle', () => {
    expect(stallIds(waiting({ orchestrator: 'done' }))).toEqual(['Q-1'])
  })
  test('parked (assumed), answered and obsolete cards do not count', () => {
    const cards = [c(1, { status: 'assumed' }), c(2, { status: 'answered' }), c(3, { status: 'obsolete' })]
    expect(stallIds(waiting({ cards }))).toBeNull()
  })
  test('only the open cards are named when parked cards sit beside them', () => {
    expect(stallIds(waiting({ cards: [c(1, { status: 'assumed' }), c(2)] }))).toEqual(['Q-2'])
  })
  test('no card at all is no stall', () => {
    expect(stallIds(waiting({ cards: [] }))).toBeNull()
  })
  test('a working worker breaks it', () => {
    expect(stallIds(waiting({ workers: [worker('idle'), worker('working')] }))).toBeNull()
  })
  test('a blocked worker breaks it', () => {
    expect(stallIds(waiting({ workers: [worker('blocked')] }))).toBeNull()
  })
  test('an idle worker without a fresh REPORT breaks it', () => {
    expect(stallIds(waiting({ workers: [worker('idle', false)] }))).toBeNull()
  })
  test('a done worker without a fresh REPORT breaks it', () => {
    expect(stallIds(waiting({ workers: [worker('done', false)] }))).toBeNull()
  })
  test('a gone worker needs no report', () => {
    expect(stallIds(waiting({ workers: [worker('gone', false)] }))).toEqual(['Q-1'])
  })
  test('a working orchestrator breaks it', () => {
    expect(stallIds(waiting({ orchestrator: 'working' }))).toBeNull()
  })
  test('an orchestrator herdr does not list breaks it', () => {
    expect(stallIds(waiting({ orchestrator: undefined }))).toBeNull()
  })
  test('herdr down breaks it', () => {
    expect(stallIds(waiting({ herdrUp: false }))).toBeNull()
  })
})

describe('pickStatus', () => {
  test('the prompt-not-sent line comes first, then the urgent badge, then the stall text', () => {
    expect(pickStatus('prompt not sent: x', '1 urgent: Q-1', 'run waits on you')).toBe('prompt not sent: x')
    expect(pickStatus(undefined, '1 urgent: Q-1', 'run waits on you')).toBe('1 urgent: Q-1')
    expect(pickStatus(undefined, undefined, 'run waits on you')).toBe('run waits on you')
    expect(pickStatus(undefined, undefined, undefined)).toBeUndefined()
  })
})

describe('stallText', () => {
  test('counts the open cards and names them', () => {
    expect(stallText(['Q-2', 'Q-5'])).toBe('run waits on you: 2 open (Q-2, Q-5)')
  })
})

describe('freshStall', () => {
  const T = 1_000_000
  const MIN2 = 120_000
  test('a stall that just began shows nothing and keeps its start', () => {
    const r = freshStall(['Q-1'], true, [], T)
    expect(r.text).toBeUndefined()
    expect(r.toast).toBeUndefined()
    expect(r.seen).toEqual([`stall:${T}:Q-1`])
  })
  test('one millisecond short of 2 min shows nothing', () => {
    const r = freshStall(['Q-1'], true, [`stall:${T}:Q-1`], T + MIN2 - 1)
    expect(r.text).toBeUndefined()
    expect(r.toast).toBeUndefined()
  })
  test('after 2 min it shows the text, toasts it once and marks the toast', () => {
    const r = freshStall(['Q-1'], true, [`stall:${T}:Q-1`], T + MIN2)
    expect(r.text).toBe('run waits on you: 1 open (Q-1)')
    expect(r.toast).toBe('run waits on you: 1 open (Q-1)')
    expect(r.seen).toEqual([`stall:${T}:Q-1`, 'stall-toast:Q-1'])
  })
  test('the same episode toasts no second time', () => {
    const r = freshStall(['Q-1'], true, [`stall:${T}:Q-1`, 'stall-toast:Q-1'], T + MIN2 + 15000)
    expect(r.text).toBe('run waits on you: 1 open (Q-1)')
    expect(r.toast).toBeUndefined()
  })
  test('a new card starts a new episode: the timer starts over and the old toast mark goes', () => {
    const r = freshStall(['Q-1', 'Q-2'], true, [`stall:${T}:Q-1`, 'stall-toast:Q-1'], T + MIN2 + 15000)
    expect(r.text).toBeUndefined()
    expect(r.toast).toBeUndefined()
    expect(r.seen).toEqual([`stall:${T + MIN2 + 15000}:Q-1,Q-2`])
  })
  test('then the new episode toasts once, after its own 2 min', () => {
    const at = T + MIN2 + 15000
    const r = freshStall(['Q-1', 'Q-2'], true, [`stall:${at}:Q-1,Q-2`], at + MIN2)
    expect(r.toast).toBe('run waits on you: 2 open (Q-1, Q-2)')
    expect(r.seen).toContain('stall-toast:Q-1,Q-2')
  })
  test('a break clears the timer at once and keeps the other marks', () => {
    const r = freshStall(null, true, ['Q-9', `stall:${T}:Q-1`, 'stall-toast:Q-1'], T + MIN2 + 15000)
    expect(r.text).toBeUndefined()
    expect(r.toast).toBeUndefined()
    expect(r.seen).toEqual(['Q-9', 'stall-toast:Q-1'])
  })
  test('a break starts the timer over when the same cards stall again, and does not toast twice', () => {
    const later = T + 5 * MIN2
    const first = freshStall(['Q-1'], true, ['stall-toast:Q-1'], later)
    expect(first.text).toBeUndefined()
    const r = freshStall(['Q-1'], true, first.seen, later + MIN2)
    expect(r.text).toBe('run waits on you: 1 open (Q-1)')
    expect(r.toast).toBeUndefined()
  })
  test('no open card left drops the toast mark too', () => {
    expect(freshStall(null, false, ['Q-9', 'stall-toast:Q-1'], T).seen).toEqual(['Q-9'])
  })
  test('the urgent marks pass through untouched', () => {
    expect(freshStall(['Q-1'], true, ['Q-9'], T).seen).toEqual(['Q-9', `stall:${T}:Q-1`])
  })
})

describe('the stall flag in the envoy session', () => {
  const ticks = async (w: any, n: number) => {
    for (let i = 0; i < n; i++) await w.clock.advance(15000)
  }
  const lines = (w: any) => w.statuses.filter((s: string | undefined) => s !== undefined)
  /** An envoy session whose team waits: the scout and the orchestrator idle in herdr, card Q-3 open. */
  const stalled = async ($: any, on: any) => {
    const w = await envoyTeam($, on)
    w.agents = [
      { pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } },
      { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } },
    ]
    card(w, 3)
    return w
  }
  const NEEDLE = 'run waits on you: 1 open (Q-3)'

  test('shows the text and toasts once after 2 min of waiting; the line and toast start no turn', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 8)
    expect(lines(w)).toEqual([])
    expect(w.toasts).toEqual([])
    expect(w.submits).toEqual([])
    await ticks(w, 1)
    expect(w.statuses.at(-1)).toBe(NEEDLE)
    expect(w.toasts).toEqual([NEEDLE])
    expect(w.submits).toEqual([])
    await ticks(w, 4)
    expect(w.toasts).toEqual([NEEDLE])
    expect(w.submits.filter((s: string) => !s.startsWith('NEXT-ACTION'))).toEqual([])
  })

  const pushes = (w: any): string[] => w.submits.filter((s: string) => s.startsWith('NEXT-ACTION'))

  test('the next-action message about a stall waits for the same 2 min as the toast, and goes once', async ($, on) => {
    const w = await stalled($, on)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    w.agents[0].agent_status = 'idle'

    await ticks(w, 8)
    expect(lines(w)).toEqual([])
    expect(pushes(w)).toEqual([])
    await ticks(w, 3)

    expect(w.statuses.at(-1)).toBe(NEEDLE)
    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Every agent waits on you')
    await ticks(w, 8)
    expect(pushes(w)).toHaveLength(1)
  })

  test('a stall that breaks before 2 min sends no message, and neither does its return', async ($, on) => {
    const w = await stalled($, on)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    w.agents[0].agent_status = 'idle'
    await ticks(w, 4)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    w.agents[0].agent_status = 'idle'

    await ticks(w, 7)

    expect(pushes(w)).toEqual([])
  })

  test('a stall that breaks before 2 min, then returns and holds for 2 more min, sends exactly one message', async ($, on) => {
    const w = await stalled($, on)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    w.agents[0].agent_status = 'idle'
    await ticks(w, 4)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    w.agents[0].agent_status = 'idle'

    await ticks(w, 8)
    expect(pushes(w)).toEqual([])
    await ticks(w, 3)

    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- Every agent waits on you')
    await ticks(w, 8)
    expect(pushes(w)).toHaveLength(1)
  })

  test('the stall toast stays 30 s', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 9)
    expect(w.toasts).toEqual([NEEDLE])
    expect(w.toastMs).toEqual([30000])
  })

  test('a worker that starts working clears the line at once', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 9)
    expect(w.statuses.at(-1)).toBe(NEEDLE)
    w.agents[0].agent_status = 'working'
    await ticks(w, 1)
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('the orchestrator is found by its session id, and working stops the flag', async ($, on) => {
    const w = await stalled($, on)
    w.agents[1].agent_status = 'working'
    await ticks(w, 12)
    expect(lines(w)).toEqual([])
    // The agent under another session id does not stand in for it.
    w.agents[1].agent_status = 'idle'
    w.agents[1].agent_session = { value: 'sid-other' }
    await ticks(w, 12)
    expect(lines(w)).toEqual([])
  })

  test('an idle briefed worker without a fresh REPORT blocks it; the report releases it', async ($, on) => {
    const w = await stalled($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, {
      role: 'investigator', topic: 't', brief: 'brief-app-1-scout-t.md', pane: 'w1:p2', session: 'sid-scout',
    })
    await ticks(w, 12)
    expect(lines(w)).toEqual([])
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-t.md`, '# Report\n\n---\n\nREPORT app-1-scout t: done\n')
    await ticks(w, 9)
    expect(w.statuses.at(-1)).toBe(NEEDLE)
  })

  test('parked cards do not count', async ($, on) => {
    const w = await stalled($, on)
    card(w, 3, { status: 'assumed' })
    await ticks(w, 12)
    expect(lines(w)).toEqual([])
  })

  test('herdr down resets the timer', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 7)
    w.herdrFails = 'herdr gone'
    await ticks(w, 1)
    w.herdrFails = null
    await ticks(w, 8)
    expect(lines(w)).toEqual([])
    await ticks(w, 1)
    expect(w.statuses.at(-1)).toBe(NEEDLE)
  })

  test('a new card starts a new episode with its own toast', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 9)
    expect(w.toasts).toHaveLength(1)
    card(w, 4)
    await ticks(w, 1)
    expect(w.statuses.at(-1)).toBeUndefined()
    await ticks(w, 8)
    expect(w.statuses.at(-1)).toBe('run waits on you: 2 open (Q-3, Q-4)')
    expect(w.toasts).toEqual([NEEDLE, 'run waits on you: 2 open (Q-3, Q-4)'])
  })

  test('answering the last open card clears the line', async ($, on) => {
    const w = await stalled($, on)
    await ticks(w, 9)
    card(w, 3, { status: 'answered', decision: 1 })
    await ticks(w, 1)
    expect(w.statuses.at(-1)).toBeUndefined()
    expect(w.json(`${w.team}/toasted.json`).some((m: string) => m.startsWith('stall'))).toBe(false)
  })

  test('the urgent badge wins the status line over the stall text, and the stall still toasts', async ($, on) => {
    const w = await stalled($, on)
    card(w, 3, { urgent: true, from: 'app-1-tester', question: 'Approve rm -rf build?' })
    await ticks(w, 1)
    await ticks(w, 9)
    expect(w.statuses.at(-1)).toBe('1 urgent: Q-3 app-1-tester: Approve rm -rf build?')
    expect(lines(w).some((s: string) => s.startsWith('run waits'))).toBe(false)
    expect(w.toasts).toEqual([NEEDLE])
  })

  test('the marks live in toasted.json, with the urgent marks beside them', async ($, on) => {
    const w = await stalled($, on)
    w.writeJson(`${w.team}/toasted.json`, ['Q-9'])
    await ticks(w, 9)
    const marks: string[] = w.json(`${w.team}/toasted.json`)
    expect(marks).toContain('Q-9')
    expect(marks.some(m => /^stall:\d+:Q-3$/.test(m))).toBe(true)
    expect(marks).toContain('stall-toast:Q-3')
  })

  test('the orchestrator session of a split team sets no stall line', async ($, on) => {
    const w = await stalled($, on)
    w.id = 'sid-orch-worker'
    await ticks(w, 12)
    expect(w.statuses).toEqual([])
    expect(w.toasts).toEqual([])
  })
})
