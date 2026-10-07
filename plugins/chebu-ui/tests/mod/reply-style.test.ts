import { describe, expect, test } from 'claude-code/testing'

import { append, mount, start } from './engine'

const assistant = (content: object[]) => ({ message: { type: 'assistant', content } })

describe('Reply style', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws an answer as markdown in a round blue frame (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mount($, 'AssistantMessage', { text: 'The **answer**.', isFirstOfReply: true }, surface)

      expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'blue' })
      expect(await ui.find({ type: 'Markdown', text: 'The **answer**.' })).toBeDefined()
    })
  }

  test('draws text a tool call followed as dim narration', async ($, on) => {
    await start($, on)
    await append($, assistant([{ type: 'text', text: 'Reading the **file**.' }, { type: 'tool_use', name: 'Read' }]))
    const ui = await mount($, 'AssistantMessage', { text: 'Reading the **file**.', isFirstOfReply: true })

    expect((await ui.find({ type: 'Text', text: 'Reading the file.' }))?.props).toMatchObject({ dimColor: true, italic: true })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  })

  test('keeps the text after the last tool call bright', async ($, on) => {
    await start($, on)
    await append($, assistant([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read' }]))
    await append($, assistant([{ type: 'text', text: 'Done.' }]))
    const ui = await mount($, 'AssistantMessage', { text: 'Done.', isFirstOfReply: true })

    expect(await ui.find({ type: 'Markdown', text: 'Done.' })).toBeDefined()
  })

  test('ignores what a subagent says', async ($, on) => {
    await start($, on)
    await append($, { agentId: 'a1', ...assistant([{ type: 'text', text: 'Sub.' }, { type: 'tool_use', name: 'Read' }]) })
    const ui = await mount($, 'AssistantMessage', { text: 'Sub.', isFirstOfReply: true })

    expect(await ui.find({ type: 'Markdown', text: 'Sub.' })).toBeDefined()
  })
})
