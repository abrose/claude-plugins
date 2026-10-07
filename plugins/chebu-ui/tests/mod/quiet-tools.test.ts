import { describe, expect, test } from 'claude-code/testing'

import { mount, start } from './engine'

describe('Quiet tools', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws a tool call as one dim line (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mount($, 'ToolUse', { tool: 'Bash', input: { command: 'ls  -la' }, isRunning: false }, surface)

      expect((await ui.find({ type: 'Text', text: '  · Bash ls -la' }))?.props).toMatchObject({ dimColor: true })
    })
  }

  test('leaves an Edit to the engine', async ($, on) => {
    await start($, on)
    const ui = await mount($, 'ToolUse', { tool: 'Edit', input: { file_path: '/a.ts' } })

    expect(await ui.find({ type: 'Text', text: /Edit/ })).toBeUndefined()
  })

  test('shows the first three lines of Bash output and counts the rest', async ($, on) => {
    await start($, on)
    const stdout = ['one', 'two', 'three', 'four', 'five'].join('\n')
    const ui = await mount($, 'ToolResult', { tool: 'Bash', output: { stdout, stderr: '' } })

    expect(await ui.find({ type: 'Text', text: 'three' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'four' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '… 2 more lines (ctrl+o)' })).toBeDefined()
  })
})
