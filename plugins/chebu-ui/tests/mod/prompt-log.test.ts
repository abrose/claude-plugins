import { describe, expect, test } from 'claude-code/testing'

import { mount, start, submit } from './engine'

const runPrompts = ($: any) => $.command.run({ command: 'prompts', args: '' } as never)

describe('Prompt log', () => {
  test('/prompts opens the pane, and closes it when it is open', async ($, on) => {
    const { panes } = await start($, on)

    expect(await runPrompts($)).toMatchObject({ text: 'Prompt list opened.' })
    expect(panes.has('prompt-log')).toBe(true)
    expect(await runPrompts($)).toMatchObject({ text: 'Prompt list closed.' })
    expect(panes.has('prompt-log')).toBe(false)
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
})
