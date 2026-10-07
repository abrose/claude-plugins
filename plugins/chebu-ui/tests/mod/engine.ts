import { mock } from 'claude-code/testing'

/** Components the plugin may hand back to the engine with next(e); the engine draws a marked row. */
const ENGINE_ROWS = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'TurnDuration', 'AbovePrompt']

/** Stands in for the engine beneath the plugin, then starts the session. */
export async function start($: any, on: any) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const panes = new Set<string>()

  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('turn.start', () => ({ turnId: 'turn-1' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', ($: any, e: any) => {
    panes.add(e.id)
    return { value: { isOpen: true } }
  })
  on('ui.close', ($: any, e: any) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isPlaced: true })) }))
  for (const component of ENGINE_ROWS) {
    on('ui.render', { component }, ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)
      return h(Text, { key: 'engine-row' }, component)
    })
  }

  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

  return { clock, panes }
}

/** Sends an own prompt; a turnId means a turn was running, so the prompt waits in the queue. */
export const submit = ($: any, text: string, turnId?: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, ...(turnId === undefined ? {} : { turnId }) } as never)

/**
 * Raises session.append for one row. The kit cannot answer it: a test hook that answers without
 * next is skipped, and none leaves nothing beneath. The plugin notes the row before it calls next,
 * so the missing answer is swallowed here.
 */
export async function append($: any, row: object) {
  try {
    await $.session.append(row as never)
  } catch (error) {
    if (!String(error).includes('no implementation for session.append')) {
      throw error
    }
  }
}

export const mount =($: any, component: string, props: object, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'chebu-ui', surface, component, props } as never)
