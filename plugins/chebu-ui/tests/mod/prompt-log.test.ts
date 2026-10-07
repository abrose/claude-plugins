import { describe, expect, test } from 'claude-code/testing'

import { mount, start, submit } from './engine'

const mountPane = ($: any) =>
  $.ui.mount({ plugin: 'chebu-ui', surface: 'terminal', component: 'Pane', requestId: 'prompt-log', props: {} } as never)

const runPrompts =($: any) => $.command.run({ command: 'prompts', args: '' } as never)

describe('Prompt log', () => {
  test('/prompts opens the pane, and closes it when it is open', async ($, on) => {
    const { panes } = await start($, on)

    expect(await runPrompts($)).toMatchObject({ text: 'Prompt list opened.' })
    expect(panes.has('prompt-log')).toBe(true)
    expect(await runPrompts($)).toMatchObject({ text: 'Prompt list closed.' })
    expect(panes.has('prompt-log')).toBe(false)
  })

  test('/prompts brings the pane out from behind another tab instead of closing it', async ($, on) => {
    const { panes, hidden } = await start($, on)
    await runPrompts($)
    hidden.add('prompt-log')

    expect(await runPrompts($)).toMatchObject({ text: 'Prompt list opened.' })
    expect(panes.has('prompt-log')).toBe(true)
    expect(hidden.has('prompt-log')).toBe(false)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the band button toggles the pane (${surface})`, async ($, on) => {
      const { panes } = await start($, on)
      const ui = await mount($, 'AbovePrompt', { hasSurvey: false, isWorking: false }, surface)

      expect((await ui.find({ key: 'prompts' }))?.props).toMatchObject({ hotkey: 'p', label: 'p: prompts' })
      await ui.press({ key: 'prompts' })
      expect(panes.has('prompt-log')).toBe(true)
      await ui.press({ key: 'prompts' })
      expect(panes.has('prompt-log')).toBe(false)
    })
  }

  test('the band yields to a survey', async ($, on) => {
    await start($, on)
    const ui = await mount($, 'AbovePrompt', { hasSurvey: true, isWorking: false })

    expect(await ui.find({ key: 'prompts' })).toBeUndefined()
  })

  test('the pane lists own prompts, numbered, and marks a queued one', async ($, on) => {
    await start($, on)
    await submit($, 'first prompt')
    await submit($, 'second prompt', 'turn-0')
    const ui = await $.ui.mount({ plugin: 'chebu-ui', surface: 'terminal', component: 'Pane', requestId: 'prompt-log', props: {} } as never)

    expect(await ui.find({ type: 'Text', text: '#1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'first prompt' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⏳ second prompt/ })).toBeDefined()
  })

  test('the pane folds a prompt longer than five rows', async ($, on) => {
    await start($, on)
    await submit($, 'short one')
    await submit($, 'x'.repeat(1000))
    const ui = await $.ui.mount({ plugin: 'chebu-ui', surface: 'terminal', component: 'Pane', requestId: 'prompt-log', props: {} } as never)

    // 80 columns less the tag, time, fold columns and right padding leave 67 cells a row: 15 rows, 4 kept, 11 folded.
    const kept = await ui.find({ type: 'Text', text: /^x+…$/ })
    expect(kept?.text.length).toBe(4 * 67)
    expect((await ui.find({ key: 'fold:2' }))?.props).toMatchObject({ label: '▶' })
    expect(await ui.find({ type: 'Text', text: /─ 11 more lines hidden ─/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'short one' })).toBeDefined()
  })

  test('the pane keeps the newlines of a prompt', async ($, on) => {
    await start($, on)
    await submit($, 'line one\nline two\r\nline three\n')
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'line one\nline two\nline three' })).toBeDefined()
    expect(await ui.find({ key: 'fold:1' })).toBeUndefined()
  })

  test('the pane trims trailing spaces so they do not count as rows', async ($, on) => {
    await start($, on)
    const padded = Array.from({ length: 5 }, (_, i) => `line ${i + 1}${' '.repeat(200)}`)
    await submit($, padded.join('\n'))
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'line 1\nline 2\nline 3\nline 4\nline 5' })).toBeDefined()
    expect(await ui.find({ key: 'fold:1' })).toBeUndefined()
  })

  test('the pane strips the frame of text copied from a terminal box', async ($, on) => {
    await start($, on)
    const pad = ' '.repeat(150)
    await submit($, [`First line.${pad}│`, `│${pad}│`, `│ - a point${pad}│`, `│ Last line.`].join('\n'))
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'First line.\n\n- a point\nLast line.' })).toBeDefined()
    expect(await ui.find({ key: 'fold:1' })).toBeUndefined()
  })

  test('the pane hides the pasted_content tags around a paste', async ($, on) => {
    await start($, on)
    await submit($, 'see this:\n<pasted_content id="3dae">\nthe pasted block\n</pasted_content id="3dae">')
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'see this:\nthe pasted block' })).toBeDefined()
  })

  test('draws every prompt and leaves the window to the pane', async ($, on) => {
    await start($, on)
    for (let i = 1; i <= 40; i++) {
      await submit($, `prompt ${i}`)
    }
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'prompt 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'prompt 40' })).toBeDefined()
  })

  test('a fold opens and closes on a press', async ($, on) => {
    await start($, on)
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`)
    await submit($, lines.join('\n'))
    const ui = await mountPane($)

    expect(await ui.find({ type: 'Text', text: 'line 1\nline 2\nline 3\nline 4' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /line 5/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /─ 6 more lines hidden ─/ })).toBeDefined()

    await ui.press({ key: 'fold:1' })
    expect(await ui.find({ type: 'Text', text: lines.join('\n') })).toBeDefined()
    expect((await ui.find({ key: 'fold:1' }))?.props).toMatchObject({ label: '▼' })
    expect(await ui.find({ type: 'Text', text: /more lines hidden/ })).toBeUndefined()

    await ui.press({ key: 'fold:1' })
    expect(await ui.find({ type: 'Text', text: /line 5/ })).toBeUndefined()
  })
})
