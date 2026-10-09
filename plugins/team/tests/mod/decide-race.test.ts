import { describe, expect, test } from 'claude-code/testing'
import { call, card, envoyTeam } from './world'

const HEAD = '# Decisions APP-1\nNumbered, dated, one paragraph each. Amendments: 3a replaces 3, 5a amends 5.\nEvery brief reads this file first. Only the envoy writes it, through the `decide` tool.\n'
const file = (w: any) => `${w.cwd}/scratchpad/current/decisions-APP-1.md`

describe('decide in parallel', () => {
  test('two decide calls in one turn get distinct numbers and both paragraphs', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    card(w, 2)
    const results = await Promise.all([
      call($, 'decide', { cards: ['Q-1'], answer: 'Use real fixtures.', rationale: 'r1' }),
      call($, 'decide', { cards: ['Q-2'], answer: 'Keep the snapshot.', rationale: 'r2' }),
    ])
    expect(results.map((r: any) => r.result).sort()).toEqual(['Decision 1', 'Decision 2'])
    const text = w.files.get(file(w))!.text
    expect(text).toContain('Use real fixtures.')
    expect(text).toContain('Keep the snapshot.')
    expect(w.json(`${w.team}/questions/Q-1.json`).decision)
      .not.toBe(w.json(`${w.team}/questions/Q-2.json`).decision)
  })
})
