import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { PromptStyle } from '../../types'

export const STYLES: PromptStyle[] = ['box', 'banner', 'gutter', 'label', 'double']
const style = atom({ plugin: 'chebu-ui', key: 'promptStyle' } as const, 'double')

export function registerPromptStyle(on: On) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-style',
      description: `Switch how your prompts look: ${STYLES.join(', ')} (no argument cycles)`,
    })

    return next(e)
  })

  on('command.run', { command: 'prompt-style' }, async ($, e) => {
    const wanted = e.args.trim()

    if (wanted !== '' && !STYLES.includes(wanted as PromptStyle)) {
      return { text: `Unknown style "${wanted}". Pick one of: ${STYLES.join(', ')}` }
    }

    const current = await read($, style)
    const chosen = wanted !== ''
      ? (wanted as PromptStyle)
      : STYLES[(STYLES.indexOf(current) + 1) % STYLES.length]
    await update($, style, () => chosen)

    return { text: `Prompt style: ${chosen}` }
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const isOwnPrompt = e.props.origin.kind === 'composer' || e.props.origin.kind === 'bridge'

    if (!isOwnPrompt) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const text = e.props.text

    switch (await read($, style)) {
      case 'banner':
        return (
          <Box backgroundColor="magenta" width="100%" paddingX={1} marginTop={1}>
            <Text color="black" bold>
              ❯ {text}
            </Text>
          </Box>
        )
      case 'gutter':
        return (
          <Box flexDirection="row" marginTop={1}>
            <Box backgroundColor="yellow" width={1} />
            <Box paddingLeft={1}>
              <Text color="yellow" bold>
                {text}
              </Text>
            </Box>
          </Box>
        )
      case 'label':
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text color="black" backgroundColor="cyan" bold>
              {' YOU '}
            </Text>
            <Box paddingLeft={2}>
              <Text color="cyan" bold>
                {text}
              </Text>
            </Box>
          </Box>
        )
      case 'box':
        return (
          <Box borderStyle="round" borderColor="magenta" paddingX={1} marginTop={1}>
            <Text color="magenta" bold>
              ❯ {text}
            </Text>
          </Box>
        )
      default:
        return (
          <Box borderStyle="double" borderColor="green" width="100%" paddingX={1} marginTop={1}>
            <Text color="green" bold>
              ❯ {text}
            </Text>
          </Box>
        )
    }
  })
}
