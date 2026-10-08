import { describe, expect, test } from 'claude-code/testing'
import { queueGroups } from '../../hooks/mod/cards'
import { call, card, envoyTeam, team } from './world'

const c = (n: number, tag: string, more: object = {}) =>
  ({ id: `Q-${n}`, n, tag, door: 'two-way', status: 'open', urgent: false, ...more }) as any

describe('queueGroups', () => {
  test('groups by tag; urgent, one-way, open before assumed, oldest first', () => {
    const groups = queueGroups([
      c(1, 'a'), c(2, 'a', { door: 'one-way' }), c(3, 'a', { urgent: true, status: 'assumed' }),
      c(4, 'a', { status: 'answered' }), c(5, 'b'), c(6, 'b', { status: 'assumed' }), c(7, 'b'),
    ])
    expect(groups.map(g => [g.tag, g.count, g.cards.map(x => x.id)])).toEqual([
      ['a', 3, ['Q-3', 'Q-2', 'Q-1']],
      ['b', 3, ['Q-5', 'Q-7', 'Q-6']],
    ])
  })

  test('a tag filter keeps one group', () => {
    expect(queueGroups([c(1, 'a'), c(2, 'b')], 'b').map(g => g.tag)).toEqual(['b'])
  })
})

describe('queue tool', () => {
  test('returns the groups in the envoy session', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 1, { tag: 'fixtures' })
    const r = await call($, 'queue', {})
    expect(JSON.parse(r.result).groups[0]).toMatchObject({ tag: 'fixtures', count: 1 })
  })

  test('refuses in a session that is not the envoy', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    expect(await call($, 'queue', {})).toMatchObject({ isError: true, result: 'queue works only in the envoy session' })
  })

  test('refuses a worker session', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-scout'
    expect(await call($, 'queue', {})).toMatchObject({ isError: true, result: 'queue works only in the envoy session' })
  })

  test('a tag input returns only that group', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 1, { tag: 'fixtures' })
    card(w, 2, { tag: 'auth' })
    const r = await call($, 'queue', { tag: 'auth' })
    expect(JSON.parse(r.result).groups.map((g: any) => g.tag)).toEqual(['auth'])
  })

  test('without envoy_session the orchestrator session holds the envoy tools', async ($, on) => {
    const w = await team($, on)
    card(w, 1)
    expect((await call($, 'queue', {})).isError).toBeUndefined()
  })
})
