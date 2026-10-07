import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { PromptStyle } from '../../types'
import { findSent, isOwn } from './state'

export const STYLES: PromptStyle[] = ['box', 'banner', 'gutter', 'label', 'double']

const style = atom({ plugin: 'chebu-ui', key: 'promptStyle' } as const, 'double')
const sent = atom({ plugin: 'chebu-ui', key: 'sent' } as const, [])

export const PROMPT_STYLE_COMMAND = {
  name: 'prompt-style',
  description: `Switch how your prompts look: ${STYLES.join(', ')} (no argument cycles)`,
}

export function registerPromptStyle(on: On) {
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
    if (!isOwn(e.props.origin)) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const text = e.props.text
    const found = findSent(await read($, sent), text)
    const tag = found === undefined ? '' : `#${found.n} `

    // A queued prompt has one look in every style, so the wait reads the same everywhere.
    if (found?.queued === true) {
      return (
        <Box key="prompt" borderStyle="dashed" borderColor="yellow" width="100%" paddingX={1} marginTop={1} flexDirection="row">
          <Text color="black" backgroundColor="yellow" bold>
            {` ${tag}⏳ queued `}
          </Text>
          <Text color="yellow" italic>
            {` ${text}`}
          </Text>
        </Box>
      )
    }

    let prompt
    switch (await read($, style)) {
      case 'banner':
        prompt = (
          <Box key="prompt"backgroundColor="magenta" width="100%" paddingX={1}>
            <Text color="black" bold>
              {tag}❯ {text}
            </Text>
          </Box>
        )
        break
      case 'gutter':
        prompt = (
          <Box key="prompt"flexDirection="row">
            <Box backgroundColor="yellow" width={1} />
            <Box paddingLeft={1}>
              <Text color="yellow" bold>
                {tag}{text}
              </Text>
            </Box>
          </Box>
        )
        break
      case 'label':
        prompt = (
          <Box key="prompt"flexDirection="column">
            <Text color="black" backgroundColor="cyan" bold>
              {` YOU ${tag}`}
            </Text>
            <Box paddingLeft={2}>
              <Text color="cyan" bold>
                {text}
              </Text>
            </Box>
          </Box>
        )
        break
      case 'box':
        prompt = (
          <Box key="prompt"borderStyle="round" borderColor="magenta" paddingX={1}>
            <Text color="magenta" bold>
              {tag}❯ {text}
            </Text>
          </Box>
        )
        break
      default:
        prompt = (
          <Box key="prompt"borderStyle="double" borderColor="green" width="100%" paddingX={1} flexDirection="row">
            {tag !== '' && (
              <Text color="black" backgroundColor="green" bold>
                {` ${tag}`}
              </Text>
            )}
            <Text color="green" bold>
              {tag !== '' ? ' ' : ''}❯ {text}
            </Text>
          </Box>
        )
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        {prompt}
      </Box>
    )
  })
}
