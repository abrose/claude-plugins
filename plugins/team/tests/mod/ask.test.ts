import { describe, expect, test } from 'claude-code/testing'
import { CARD, call, DIALOG_TEXT, team } from './world'

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

describe('prompt_of', () => {
  const scoutBlocked = (w: any) => {
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
  }
  const sub = (argv: string[]) => argv.slice(1, 3).join(' ')

  test('links the card to the blocked agent: session, pane and dialog captured by the tool', async ($, on) => {
    const w = await team($, on)
    scoutBlocked(w)

    expect(await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' })).toMatchObject({ result: 'Q-1' })

    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.prompt).toEqual({
      agent: 'app-1-scout', role: 'investigator', session: 'sid-scout', pane: 'w1:p2', dialog: DIALOG_TEXT,
      at: w.clock.now(),
    })
    expect(filed.context).toBe(
      `${CARD.context}\nThe tool linked this card to the permission prompt of the investigator (w1:p2). ` +
      'It closes by itself when that prompt is gone.')
  })

  test('a card without prompt_of has no prompt link', async ($, on) => {
    const w = await team($, on)
    scoutBlocked(w)

    await call($, 'ask', CARD)

    expect(w.json(`${w.team}/questions/Q-1.json`).prompt).toBeUndefined()
  })

  test('naming no team agent refuses the card', async ($, on) => {
    const w = await team($, on)

    expect(await call($, 'ask', { ...CARD, prompt_of: 'app-1-nobody' }))
      .toMatchObject({ isError: true, result: 'prompt_of names no team agent: app-1-nobody' })
    expect([...w.files.keys()].some(p => p.includes('/questions/'))).toBe(false)
  })

  test('naming the filer itself refuses the card', async ($, on) => {
    const w = await asScout($, on)

    expect(await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' }))
      .toMatchObject({ isError: true, result: 'prompt_of names the filer itself: app-1-scout' })
    expect([...w.files.keys()].some(p => p.includes('/questions/'))).toBe(false)
  })

  test('a value that is no agent name refuses the card', async ($, on) => {
    const w = await team($, on)

    expect(await call($, 'ask', { ...CARD, prompt_of: 7 }))
      .toMatchObject({ isError: true, result: 'prompt_of must be the name of a team agent' })
    expect([...w.files.keys()].some(p => p.includes('/questions/'))).toBe(false)
  })

  test('an agent that shows no prompt files the card linked and warns the filer', async ($, on) => {
    const w = await team($, on)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]

    const r = await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' })

    expect(r.isError).toBeUndefined()
    expect(r.result).toBe(
      'Q-1\nWarning: app-1-scout shows no permission prompt now. The card closes by itself in about 30 s unless one shows.')
    expect(w.json(`${w.team}/questions/Q-1.json`).prompt).toEqual({
      agent: 'app-1-scout', role: 'investigator', session: 'sid-scout', pane: 'w1:p2', dialog: '', at: w.clock.now(),
    })
  })

  test('a failed dialog read files the card with an empty fingerprint', async ($, on) => {
    const w = await team($, on)
    scoutBlocked(w)
    w.fails.set('agent read', 'timed out')

    const r = await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' })

    expect(r).toMatchObject({ result: 'Q-1' })
    expect(w.json(`${w.team}/questions/Q-1.json`).prompt).toMatchObject({ agent: 'app-1-scout', dialog: '' })
  })

  test('a herdr that does not answer files the card linked and warns the filer', async ($, on) => {
    const w = await team($, on)
    w.herdrFails = 'server_unavailable'

    const r = await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' })

    expect(r.isError).toBeUndefined()
    expect(r.result).toBe(
      'Q-1\nWarning: herdr did not answer (server_unavailable), so the prompt of app-1-scout was not read. ' +
      'The card is linked anyway.')
    expect(w.json(`${w.team}/questions/Q-1.json`).prompt).toEqual({
      agent: 'app-1-scout', role: 'investigator', session: 'sid-scout', pane: 'w1:p2', dialog: '', at: w.clock.now(),
    })
  })

  test('both herdr calls of the tool carry a 3 s timeout', async ($, on) => {
    const w = await team($, on)
    scoutBlocked(w)

    await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout' })

    const herdr = w.runs.flatMap((argv, i) =>
      ['agent list', 'agent read'].includes(sub(argv)) ? [{ call: sub(argv), ms: w.inits[i]?.timeoutMs }] : [])
    expect(herdr).toEqual([{ call: 'agent list', ms: 3000 }, { call: 'agent read', ms: 3000 }])
  })

  test('a card that links is still urgent by the usual rules', async ($, on) => {
    const w = await team($, on)
    scoutBlocked(w)

    await call($, 'ask', { ...CARD, prompt_of: 'app-1-scout', urgent: true })

    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ urgent: true, status: 'open' })
  })
})

describe('urgent by tool', () => {
  const BRIEF = (w: any) => `${w.cwd}/scratchpad/current/brief-app-1-scout-fixtures.md`
  const denied = ($: any) =>
    $.classic.PermissionDenied({
      tool_name: 'mcp__gitlab__save_note', tool_input: {}, tool_use_id: 'tu-1', reason: 'auto mode',
    } as never)

  test('a card filed after a fresh denial is urgent, and its context says why', async ($, on) => {
    const w = await asScout($, on)
    w.write(BRIEF(w), 'brief')
    await w.clock.advance(60_000)
    await denied($)
    await w.clock.advance(120_000)

    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-1' })

    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.urgent).toBe(true)
    expect(filed.context).toBe(
      `${CARD.context}\nThe tool marked this card urgent: auto mode denied \`mcp__gitlab__save_note\` 2 min before it.`)
  })

  test('a denial older than the brief does not make a card urgent', async ($, on) => {
    const w = await asScout($, on)
    await denied($)
    await w.clock.advance(60_000)
    w.write(BRIEF(w), 'brief')

    await call($, 'ask', CARD)

    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.urgent).toBe(false)
    expect(filed.context).toBe(CARD.context)
  })

  test('a denial of another agent does not make the card urgent', async ($, on) => {
    const w = await asScout($, on)
    w.writeJson(`${w.team}/denials/app-1-other.json`, { tool: 'Bash', reason: 'auto mode', at: w.clock.now() })

    await call($, 'ask', CARD)

    expect(w.json(`${w.team}/questions/Q-1.json`).urgent).toBe(false)
  })

  test('approved_by naming an existing decision makes the card urgent, and its context says why', async ($, on) => {
    const w = await asScout($, on)
    w.writeJson(`${w.team}/decisions/2.json`, { n: 2, cards: [], answer: 'Post the 9 comments.', rationale: 'r', overrides: [], at: 1 })

    expect(await call($, 'ask', { ...CARD, approved_by: 2 })).toMatchObject({ result: 'Q-1' })

    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.urgent).toBe(true)
    expect(filed.context).toBe(`${CARD.context}\nThe tool marked this card urgent: it blocks work approved in decision 2.`)
  })

  test('approved_by naming no decision files the card non-urgent and warns the filer', async ($, on) => {
    const w = await asScout($, on)

    const r = await call($, 'ask', { ...CARD, approved_by: 9 })

    expect(r.isError).toBeUndefined()
    expect(r.result).toBe('Q-1\nWarning: approved_by names decision 9, which does not exist. It did not make the card urgent.')
    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.urgent).toBe(false)
    expect(filed.context).toBe(`${CARD.context}\napproved_by names decision 9, which does not exist.`)
  })

  test('approved_by that is no positive whole number is never read as a path: non-urgent, warned', async ($, on) => {
    const w = await asScout($, on)
    w.writeJson(`${w.team}/decisions/abc.json`, { n: 0, cards: [], answer: 'a', rationale: 'r', overrides: [], at: 1 })
    w.writeJson(`${w.team}/decisions/0.json`, { n: 0, cards: [], answer: 'a', rationale: 'r', overrides: [], at: 1 })

    const text = await call($, 'ask', { ...CARD, approved_by: 'abc' })
    const zero = await call($, 'ask', { ...CARD, approved_by: 0 })

    const warning = '\nWarning: approved_by is not a decision number (a positive whole number). It did not make the card urgent.'
    expect(text).toMatchObject({ result: `Q-1${warning}` })
    expect(zero).toMatchObject({ result: `Q-2${warning}` })
    for (const id of ['Q-1', 'Q-2']) {
      const filed = w.json(`${w.team}/questions/${id}.json`)
      expect(filed.urgent).toBe(false)
      expect(filed.context).toBe(`${CARD.context}\napproved_by is not a decision number (a positive whole number).`)
    }
  })

  test('a filer that sets urgent stays urgent, with no line added', async ($, on) => {
    const w = await asScout($, on)

    await call($, 'ask', { ...CARD, urgent: true })

    const filed = w.json(`${w.team}/questions/Q-1.json`)
    expect(filed.urgent).toBe(true)
    expect(filed.context).toBe(CARD.context)
  })
})
