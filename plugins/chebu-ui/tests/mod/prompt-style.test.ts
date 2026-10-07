import { describe, expect, test } from 'claude-code/testing'

import { mount, start, submit } from './engine'

const mountMessage = ($: any, surface: 'terminal' | 'desktop', origin: { kind: string }, text = 'find me later') =>
  mount($, 'UserMessage', { text, origin, isExpanded: true }, surface)

const runStyle = ($: any, args: string) => $.command.run({ command: 'prompt-style', args } as never)

describe('Prompt style', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws an own prompt in a green double frame by default (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mountMessage($, surface, { kind: 'composer' })

      expect((await ui.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'double', borderColor: 'green' })
      expect(await ui.find({ type: 'Text', text: /find me later/ })).toBeDefined()
    })
  }

  test('also styles a prompt sent from phone or web', async ($, on) => {
    await start($, on)
    const ui = await mountMessage($, 'terminal', { kind: 'bridge' })

    expect((await ui.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'double' })
  })

  test('leaves messages from tasks and other agents alone', async ($, on) => {
    await start($, on)
    const ui = await mountMessage($, 'terminal', { kind: 'task-notification' })

    expect(await ui.find({ type: 'Box' })).toBeUndefined()
  })

  test('hides the pasted_content tags around a paste, and still numbers the prompt', async ($, on) => {
    await start($, on)
    const pasted = 'see this:\n\n<pasted_content id="3dae">\nthe pasted block\n</pasted_content id="3dae">'
    await submit($, pasted)
    const ui = await mountMessage($, 'terminal', { kind: 'composer' }, pasted)

    expect(await ui.find({ type: 'Text', text: /see this:\n\nthe pasted block$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /pasted_content/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /#1/ })).toBeDefined()
  })

  test('numbers each prompt in the order sent', async ($, on) => {
    await start($, on)
    await submit($, 'first')
    await submit($, 'find me later')
    const ui = await mountMessage($, 'terminal', { kind: 'composer' })

    expect(await ui.find({ type: 'Text', text: /#2/ })).toBeDefined()
  })

  test('draws a queued prompt in a dashed yellow frame until its turn starts', async ($, on) => {
    await start($, on)
    await submit($, 'find me later', 'turn-0')

    const waiting = await mountMessage($, 'terminal', { kind: 'composer' })
    expect((await waiting.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'dashed', borderColor: 'yellow' })
    expect(await waiting.find({ type: 'Text', text: /queued/ })).toBeDefined()
    await waiting.unmount()

    await $.turn.start({ text: 'find me later' } as never)
    const delivered = await mountMessage($, 'terminal', { kind: 'composer' })
    expect((await delivered.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'double' })
  })

  test('/prompt-style <name> switches the style', async ($, on) => {
    await start($, on)
    expect(await runStyle($, 'box')).toMatchObject({ text: 'Prompt style: box' })

    const ui = await mountMessage($, 'terminal', { kind: 'composer' })
    expect((await ui.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'magenta' })
  })

  test('/prompt-style with no argument cycles to the next style', async ($, on) => {
    await start($, on)
    expect(await runStyle($, 'label')).toMatchObject({ text: 'Prompt style: label' })
    expect(await runStyle($, '')).toMatchObject({ text: 'Prompt style: double' })
    expect(await runStyle($, '')).toMatchObject({ text: 'Prompt style: box' })
  })

  test('/prompt-style rejects an unknown name and keeps the style', async ($, on) => {
    await start($, on)
    expect(await runStyle($, 'neon')).toMatchObject({ text: expect.stringContaining('Unknown style "neon"') })

    const ui = await mountMessage($, 'terminal', { kind: 'composer' })
    expect((await ui.find({ key: 'prompt' }))?.props).toMatchObject({ borderStyle: 'double' })
  })
})
