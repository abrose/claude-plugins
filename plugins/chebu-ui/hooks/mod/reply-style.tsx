import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

const narration = atom({ plugin: 'chebu-ui', key: 'narration' } as const, [])

export function registerReplyStyle(on: On) {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const block = e.props.text.trim()

    // Narration is text a tool call followed; anything else (the answer, an older reply) stays bright.
    if (e.props.isSummary === true || (await read($, narration)).includes(block)) {
      return (
        <Box flexDirection="row" marginTop={e.props.isFirstOfReply ? 1 : 0}>
          <Box flexShrink={0} width={2}>
            <Text dimColor>·</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor italic wrap="wrap">
              {block.replace(/\*\*/g, '')}
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box marginTop={1} borderStyle="round" borderColor="blue" paddingX={1}>
        <Markdown text={e.props.text} />
      </Box>
    )
  })
}
