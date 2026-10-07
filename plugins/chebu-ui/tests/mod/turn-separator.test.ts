import { describe, expect, test } from 'claude-code/testing'

import { mount, start } from './engine'

describe('Turn separator', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws the turn length as a rule (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mount($, 'TurnDuration', { durationMs: 75_000, word: 'Worked for' }, surface)

      expect(await ui.find({ type: 'Text', text: '── Worked for 1m 15s ' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^─{40}/ })).toBeDefined()
    })
  }

  test('adds the time the turn ended', async ($, on) => {
    const { clock } = await start($, on)
    await $.turn.complete({ durationMs: 3_000, answer: 'ok' } as never)
    const ui = await mount($, 'TurnDuration', { durationMs: 3_200, word: 'Worked for' })

    const d = new Date(clock.now())
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    expect(await ui.find({ type: 'Text', text: `── ${time} · Worked for 3s ` })).toBeDefined()
  })
})
