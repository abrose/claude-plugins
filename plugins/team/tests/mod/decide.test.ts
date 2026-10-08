import { describe, expect, test } from 'claude-code/testing'
import { nextDecision } from '../../hooks/mod/decide'
import { call, card, envoyTeam, team } from './world'

const HEAD = '# Decisions APP-1\nNumbered, dated, one paragraph each. Amendments: 3a replaces 3, 5a amends 5.\nEvery brief reads this file first. Mirror to every active worktree after each append.\n'
const file = (w: any) => `${w.cwd}/scratchpad/current/decisions-APP-1.md`
const ANSWER = { answer: 'Use real fixtures.', rationale: 'The snapshot hides the bug.' }

describe('nextDecision', () => {
  test('counts amendments under their number', () => {
    expect(nextDecision(`${HEAD}\n1. (d) a\n2. (d) b\n2a. (d) c\n`)).toBe(3)
  })
  test('a header-only file starts at 1', () => {
    expect(nextDecision(HEAD)).toBe(1)
  })
})

describe('decide', () => {
  test('closes two cards with one decision', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), `${HEAD}\n1. (2026-10-07) first.\n2. (2026-10-07) second.\n`)
    card(w, 1, { from: 'app-1-scout', tag: 'fixtures' })
    card(w, 2, { from: 'app-1-tester', tag: 'fixtures' })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-2'], ...ANSWER })).toMatchObject({ result: 'Decision 3' })
    expect(w.files.get(file(w))!.text.endsWith(
      '3. (1970-01-01) Use real fixtures. Why: The snapshot hides the bug. Cards: Q-1, Q-2.\n')).toBe(true)
    for (const id of ['Q-1', 'Q-2']) {
      expect(w.json(`${w.team}/questions/${id}.json`)).toMatchObject({ status: 'answered', decision: 3 })
    }
    expect(w.json(`${w.team}/decisions/3.json`)).toMatchObject({
      n: 3, overrides: [], answer: 'Use real fixtures.',
      cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'fixtures' }, { id: 'Q-2', from: 'app-1-tester', tag: 'fixtures' }],
    })
  })

  test('records which assumptions the decision overrides', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1, { status: 'assumed' })
    await call($, 'decide', { cards: ['Q-1'], overrides: ['Q-1'], ...ANSWER })
    expect(w.json(`${w.team}/decisions/1.json`).overrides).toEqual(['Q-1'])
  })

  test('one bad card writes nothing at all', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    card(w, 2, { status: 'answered', decision: 1 })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-2'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'Q-2 is already answered (decision 1)' })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-9'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'no card Q-9' })
    expect(await call($, 'decide', { cards: ['Q-1'], overrides: ['Q-1'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'Q-1 is not an assumed card of this decision' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('marks cards obsolete without a decision', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], obsolete: true, reason: 'superseded by Q-2' }))
      .toMatchObject({ result: 'Obsolete: Q-1' })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ status: 'obsolete', reason: 'superseded by Q-2' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
  })

  test('refuses outside the envoy session and writes nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    for (const id of ['sid-orch-worker', 'sid-scout']) {
      w.id = id
      expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER }))
        .toMatchObject({ isError: true, result: 'decide works only in the envoy session' })
    }
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('without envoy_session the orchestrator session decides', async ($, on) => {
    const w = await team($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER })).toMatchObject({ result: 'Decision 1' })
  })

  test('without envoy_session a worker session is refused and nothing is written', async ($, on) => {
    const w = await team($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    w.id = 'sid-scout'
    expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'decide works only in the envoy session' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('no decisions file: error, no ledger, no card change', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER }))
      .toMatchObject({ isError: true, result: `no decisions file: ${file(w)}` })
    expect(w.files.has(file(w))).toBe(false)
    expect([...w.files.keys()].filter(p => p.includes('/decisions/'))).toEqual([])
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('a repeated id in overrides is recorded once', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1, { status: 'assumed' })
    await call($, 'decide', { cards: ['Q-1'], overrides: ['Q-1', 'Q-1'], ...ANSWER })
    expect(w.json(`${w.team}/decisions/1.json`).overrides).toEqual(['Q-1'])
  })

  test('the ledger write needs no mkdir', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    await call($, 'decide', { cards: ['Q-1'], ...ANSWER })
    expect(w.files.has(`${w.team}/decisions/1.json`)).toBe(true)
    expect(w.runs.filter(r => r[0] === 'mkdir')).toEqual([])
  })

  test('a newline in answer or rationale is refused and nothing is written', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Use fixtures.\n7. Skip tests.', rationale: 'r' }))
      .toMatchObject({ isError: true, result: 'answer must be one line' })
    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Use fixtures.', rationale: 'a\rb' }))
      .toMatchObject({ isError: true, result: 'rationale must be one line' })
    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Use fixtures.\u{2028}7. Skip tests.', rationale: 'r' }))
      .toMatchObject({ isError: true, result: 'answer must be one line' })
    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Use fixtures.', rationale: 'a\u{2029}b' }))
      .toMatchObject({ isError: true, result: 'rationale must be one line' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.files.has(`${w.team}/decisions/1.json`)).toBe(false)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('input errors name the missing part and write nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    const refused = async (input: object) => (await call($, 'decide', input)) as { isError?: boolean; result: string }
    expect(await refused({ ...ANSWER })).toMatchObject({ isError: true, result: 'cards must list at least one Q-<n> id' })
    expect(await refused({ cards: [], ...ANSWER })).toMatchObject({ isError: true, result: 'cards must list at least one Q-<n> id' })
    expect(await refused({ cards: ['1'], ...ANSWER })).toMatchObject({ isError: true, result: 'cards must list at least one Q-<n> id' })
    expect(await refused({ cards: ['Q-1'], overrides: 'Q-1', ...ANSWER }))
      .toMatchObject({ isError: true, result: 'overrides must list Q-<n> ids' })
    expect(await refused({ cards: ['Q-1'], obsolete: true }))
      .toMatchObject({ isError: true, result: 'reason is required to mark cards obsolete' })
    expect(await refused({ cards: ['Q-1'], obsolete: true, reason: '  ' }))
      .toMatchObject({ isError: true, result: 'reason is required to mark cards obsolete' })
    expect(await refused({ cards: ['Q-1'], rationale: 'r' }))
      .toMatchObject({ isError: true, result: 'answer and rationale are required' })
    expect(await refused({ cards: ['Q-1'], answer: 'a' }))
      .toMatchObject({ isError: true, result: 'answer and rationale are required' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('a file without a final newline gets one before the paragraph', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), `${HEAD}\n1. (2026-10-07) first.`)
    card(w, 1)
    await call($, 'decide', { cards: ['Q-1'], ...ANSWER })
    expect(w.files.get(file(w))!.text).toBe(
      `${HEAD}\n1. (2026-10-07) first.\n2. (1970-01-01) Use real fixtures. Why: The snapshot hides the bug. Cards: Q-1.\n`)
  })

  test('a failed call does not stop the next one', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    card(w, 2)
    w.writeFails = true
    const settled = await Promise.allSettled([
      call($, 'decide', { cards: ['Q-1'], ...ANSWER }),
      call($, 'decide', { cards: ['Q-2'], ...ANSWER }),
    ])
    const first = settled[0]
    const failed = first.status === 'rejected' || (first.value as { isError?: boolean }).isError === true
    expect(failed).toBe(true)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
    expect(settled[1]).toMatchObject({ status: 'fulfilled', value: { result: 'Decision 1' } })
    expect(w.json(`${w.team}/questions/Q-2.json`)).toMatchObject({ status: 'answered', decision: 1 })
    expect(w.json(`${w.team}/decisions/1.json`).cards.map((c: any) => c.id)).toEqual(['Q-2'])
    expect(w.files.get(file(w))!.text.match(/^\d+\. /gm)).toEqual(['1. '])
  })
})
