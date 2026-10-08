import { describe, expect, test } from 'claude-code/testing'
import { badgeText, freshUrgent, toastText } from '../../hooks/mod/badge'
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
