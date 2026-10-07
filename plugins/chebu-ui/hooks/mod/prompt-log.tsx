import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { clockTime } from './state'

const PANE = 'prompt-log'
const sent = atom({ plugin: 'chebu-ui', key: 'sent' } as const, [])

export const PROMPTS_COMMAND = {
  name: 'prompts',
  description: 'Show or hide the prompts you sent this session in a pane',
}

/** Opens the prompt pane, or closes it when it is open; says which it did. */
async function togglePane($: EngineInterface) {
  if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
    await $.ui.close({ id: PANE })

    return 'closed'
  }
  await $.ui.open({ id: PANE, title: 'My prompts' })

  return 'opened'
}

export function registerPromptLog(on: On) {
  on('command.run', { command: 'prompts' }, async $ => ({ text: `Prompt list ${await togglePane($)}.` }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button } = $.ui.resolve(e)

    // A Button that is not plain draws `[ label ]` and hides its hotkey, so the label names it.
    return (
      <Box>
        <Button key="prompts" label="p: prompts" hotkey="p" variant="primary" onPress={() => togglePane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = (await read($, sent)).map((one, i) => ({
      n: i + 1, time: clockTime(one.at), text: one.text.replace(/\s+/g, ' '), queued: one.queued === true,
    }))
    const tagWidth = `#${list.length} `.length
    const textWidth = Math.max(10, (e.viewport?.columns ?? 80) - tagWidth - 'HH:MM '.length)

    // Newest first until the pane is full, each prompt taking as many rows as it wraps to.
    let room = Math.max(1, (e.viewport?.rows ?? 24) - 4)
    const shown: typeof list = []
    for (const one of [...list].reverse()) {
      room -= Math.ceil(one.text.length / textWidth) || 1
      if (room < 0 && shown.length > 0) {
        break
      }
      shown.unshift(one)
    }

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No prompts yet.</Text>}
        {shown.map(({ n, time, text, queued }) => (
          <Box flexDirection="row">
            <Box flexShrink={0} width={tagWidth}>
              <Text color={queued ? 'yellow' : 'green'} bold>{`#${n}`}</Text>
            </Box>
            <Box flexShrink={0} width={6}>
              <Text color="gray">{time}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap" color={queued ? 'yellow' : undefined} italic={queued}>
                {queued ? `⏳ ${text}` : text}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
