import { describe, expect, test } from 'claude-code/testing'

import { append, mount, start } from './engine'

const assistant = (content: object[]) => ({ message: { type: 'assistant', content } })

describe('Reply style', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws an answer on a tinted background, without a frame (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mount($, 'AssistantMessage', { text: 'The **answer**.', isFirstOfReply: true }, surface)

      const box = (await ui.find({ type: 'Box' }))?.props
      expect(box).toMatchObject({ backgroundColor: '#1e2a3a' })
      expect(box?.borderStyle).toBeUndefined()
    })

    // Another mod beneath (gfm-render draws alerts and diagrams) must still get its turn.
    test(`tints the drawing of the hooks beneath instead of replacing it (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mount($, 'AssistantMessage', { text: 'The **answer**.', isFirstOfReply: true }, surface)

      expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeDefined()
      expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    })
  }

  test('draws text a tool call followed as dim narration', async ($, on) => {
    await start($, on)
    await append($, assistant([{ type: 'text', text: 'Reading the **file**.' }, { type: 'tool_use', name: 'Read' }]))
    const ui = await mount($, 'AssistantMessage', { text: 'Reading the **file**.', isFirstOfReply: true })

    expect((await ui.find({ type: 'Text', text: 'Reading the file.' }))?.props).toMatchObject({ dimColor: true, italic: true })
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  })

  // Narration is a short plain line; an answer that more work follows still has structure or length.
  const answers = {
    'a heading and a table': '## Q1: the plugin\n\n| Plugin | Layer |\n| --- | --- |\n| `gitlab` | yes |',
    'a list': 'Two things:\n\n- the token\n- the network rules',
    'a numbered list': 'Steps:\n\n1. build\n2. run',
    'a code fence': 'Run this:\n\n```bash\nnpm test\n```',
    'more than 300 characters': 'word '.repeat(70),
  }
  for (const [what, text] of Object.entries(answers)) {
    test(`keeps text with ${what} bright, though a tool call followed`, async ($, on) => {
      await start($, on)
      await append($, assistant([{ type: 'text', text }, { type: 'tool_use', name: 'Bash' }]))
      const ui = await mount($, 'AssistantMessage', { text, isFirstOfReply: true })

      expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeDefined()
    })
  }

  // The status line of a reply is a pipe row, not a table: without a delimiter row it stays narration.
  test('draws a status line and a short narration as dim narration', async ($, on) => {
    await start($, on)
    const text = '| 🤖 Debugging | 🛠️ | - | - | - |\n\nI check the config now.'
    await append($, assistant([{ type: 'text', text }, { type: 'tool_use', name: 'Read' }]))
    const ui = await mount($, 'AssistantMessage', { text, isFirstOfReply: true })

    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeUndefined()
  })

  test('keeps the text after the last tool call bright', async ($, on) => {
    await start($, on)
    await append($, assistant([{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read' }]))
    await append($, assistant([{ type: 'text', text: 'Done.' }]))
    const ui = await mount($, 'AssistantMessage', { text: 'Done.', isFirstOfReply: true })

    expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeDefined()
  })

  // A question or a plan hands the turn to the person, so the text before it is the answer, not narration.
  for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
    test(`keeps the text before ${tool} bright, also after a later tool call`, async ($, on) => {
      await start($, on)
      await append($, assistant([{ type: 'text', text: 'The findings.' }, { type: 'tool_use', name: tool }]))
      await append($, assistant([{ type: 'tool_use', name: 'Read' }]))
      const ui = await mount($, 'AssistantMessage', { text: 'The findings.', isFirstOfReply: true })

      expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeDefined()
    })
  }

  test('ignores what a subagent says', async ($, on) => {
    await start($, on)
    await append($, { agentId: 'a1', ...assistant([{ type: 'text', text: 'Sub.' }, { type: 'tool_use', name: 'Read' }]) })
    const ui = await mount($, 'AssistantMessage', { text: 'Sub.', isFirstOfReply: true })

    expect(await ui.find({ type: 'Text', text: 'AssistantMessage' })).toBeDefined()
  })
})
