import { describe, expect, test } from 'claude-code/testing'
import { CARD, call, team } from './world'

const asScout = async ($: any, on: any) => {
  const w = await team($, on)
  w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'fixtures', brief: '', pane: 'w1:p2', session: 'sid-scout' })
  w.id = 'sid-scout'
  return w
}

describe('ask', () => {
  test('numbers cards per run and fills from, tag and status', async ($, on) => {
    const w = await asScout($, on)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-1' })
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-2' })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({
      id: 'Q-1', n: 1, from: 'app-1-scout', tag: 'fixtures', status: 'open',
      door: 'two-way', rework: '~1 h: swap the fixture loader', urgent: false, refs: [],
    })
  })

  test('a parked card is assumed', async ($, on) => {
    const w = await asScout($, on)
    await call($, 'ask', { ...CARD, parked: true })
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('assumed')
  })

  test('a one-way card cannot be parked', async ($, on) => {
    const w = await asScout($, on)
    expect(await call($, 'ask', { ...CARD, door: 'one-way', parked: true }))
      .toMatchObject({ isError: true, result: 'a one-way card cannot be parked: wait for the answer' })
    expect(w.files.has(`${w.team}/questions/Q-1.json`)).toBe(false)
  })

  test('refuses a card without a valid door or rework', async ($, on) => {
    await asScout($, on)
    expect(await call($, 'ask', { ...CARD, door: 'maybe' }))
      .toMatchObject({ isError: true, result: 'door must be one-way or two-way' })
    expect(await call($, 'ask', { ...CARD, rework: '' }))
      .toMatchObject({ isError: true, result: 'rework is required' })
  })

  test('the orchestrator asks as itself', async ($, on) => {
    const w = await team($, on)
    await call($, 'ask', CARD)
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ from: 'app-1-orch', tag: 'general' })
  })

  test('refuses in a session that is no team agent', async ($, on) => {
    const w = await team($, on)
    w.id = 'sid-stranger'
    expect(await call($, 'ask', CARD)).toMatchObject({
      isError: true, result: 'ask works only in a team session (an agent started by team-start, or the orchestrator)',
    })
    expect([...w.files.keys()].some(p => p.includes('/questions/'))).toBe(false)
  })

  test('two asks racing for one number get distinct ids', async ($, on) => {
    const w = await asScout($, on)
    w.raceMkdir.add(`${w.team}/questions/claims/1`)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-2' })
    expect(w.files.has(`${w.team}/questions/Q-1.json`)).toBe(false)
  })

  test('numbering continues after the highest card or claim on disk', async ($, on) => {
    const w = await asScout($, on)
    w.dirs.add(`${w.team}/questions/claims/4`)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-5' })
  })

  test('a worker with an empty topic asks under the general tag', async ($, on) => {
    const w = await team($, on)
    w.id = 'sid-scout'
    await call($, 'ask', CARD)
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ from: 'app-1-scout', tag: 'general' })
  })

  describe('input errors', () => {
    const refused = async ($: any, on: any, fields: object, error: string) => {
      const w = await asScout($, on)
      expect(await call($, 'ask', { ...CARD, ...fields })).toMatchObject({ isError: true, result: error })
      expect([...w.files.keys()].some(p => p.includes('/questions/Q-'))).toBe(false)
    }

    for (const field of ['context', 'question', 'recommendation', 'blocks']) {
      test(`refuses a missing ${field}`, async ($, on) => {
        await refused($, on, { [field]: undefined }, `${field} is required`)
      })
      test(`refuses a blank ${field}`, async ($, on) => {
        await refused($, on, { [field]: '   ' }, `${field} is required`)
      })
    }

    const NEED_OPTION = 'options need at least one { option, cost }'
    test('refuses empty options', async ($, on) => {
      await refused($, on, { options: [] }, NEED_OPTION)
    })
    test('refuses missing options', async ($, on) => {
      await refused($, on, { options: undefined }, NEED_OPTION)
    })
    test('refuses an option without a cost', async ($, on) => {
      await refused($, on, { options: [{ option: 'real fixtures' }] }, NEED_OPTION)
    })
    test('refuses one malformed option among good ones', async ($, on) => {
      await refused($, on, { options: [CARD.options[0], { option: 1, cost: 'none' }] }, NEED_OPTION)
    })

    test('refuses a parked that is a string', async ($, on) => {
      await refused($, on, { parked: 'yes' }, 'parked must be true or false')
    })
    test('refuses a missing parked', async ($, on) => {
      await refused($, on, { parked: undefined }, 'parked must be true or false')
    })

    test('with many bad fields, the first required text wins', async ($, on) => {
      await refused($, on, { context: '', question: '', options: [], door: 'maybe', parked: 'no' }, 'context is required')
    })
    test('with bad options, door and parked, options win', async ($, on) => {
      await refused($, on, { options: [], door: 'maybe', parked: 'no' }, NEED_OPTION)
    })
    test('with a bad door and parked, door wins', async ($, on) => {
      await refused($, on, { door: 'maybe', parked: 'no' }, 'door must be one-way or two-way')
    })
  })

  test('gives up after 20 failed claim tries and writes no card', async ($, on) => {
    const w = await asScout($, on)
    for (let n = 1; n <= 20; n++) w.raceMkdir.add(`${w.team}/questions/claims/${n}`)
    expect(await call($, 'ask', CARD))
      .toMatchObject({ isError: true, result: 'no free card number after 20 tries' })
    expect([...w.files.keys()].some(p => p.includes('/questions/Q-'))).toBe(false)
  })

  test('carries urgent and refs into the card as given', async ($, on) => {
    const w = await asScout($, on)
    await call($, 'ask', { ...CARD, urgent: true, refs: ['Q-3', 'brief-scout.md'] })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ urgent: true, refs: ['Q-3', 'brief-scout.md'] })
  })
})
