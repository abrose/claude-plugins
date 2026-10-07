import { describe, expect, test } from 'claude-code/testing'

/** Stands in for the engine beneath the plugin, then starts the session. */
async function start($: any, on: any) {
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine-row' }, e.props.text)
  })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
}

const mountMessage = ($: any, surface: 'terminal' | 'desktop', origin: { kind: string }) =>
  $.ui.mount({
    plugin: 'chebu-ui', surface, component: 'UserMessage',
    props: { text: 'find me later', origin, isExpanded: true },
  } as never)

const runStyle = ($: any, args: string) => $.command.run({ command: 'prompt-style', args } as never)

describe('Prompt style', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws an own prompt in a green double frame by default (${surface})`, async ($, on) => {
      await start($, on)
      const ui = await mountMessage($, surface, { kind: 'composer' })

      const frame = await ui.find({ type: 'Box' })
      expect(frame?.props).toMatchObject({ borderStyle: 'double', borderColor: 'green' })
      expect(await ui.find({ type: 'Text', text: /find me later/ })).toBeDefined()
    })
  }

  test('also styles a prompt sent from phone or web', async ($, on) => {
    await start($, on)
    const ui = await mountMessage($, 'terminal', { kind: 'bridge' })

    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ borderStyle: 'double' })
  })

  test('leaves messages from tasks and other agents alone', async ($, on) => {
    await start($, on)
    const ui = await mountMessage($, 'terminal', { kind: 'task-notification' })

    expect(await ui.find({ type: 'Box' })).toBeUndefined()
  })

  test('/prompt-style <name> switches the style', async ($, on) => {
    await start($, on)
    expect(await runStyle($, 'box')).toMatchObject({ text: 'Prompt style: box' })

    const ui = await mountMessage($, 'terminal', { kind: 'composer' })
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ borderStyle: 'round', borderColor: 'magenta' })
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
    expect((await ui.find({ type: 'Box' }))?.props).toMatchObject({ borderStyle: 'double' })
  })
})
