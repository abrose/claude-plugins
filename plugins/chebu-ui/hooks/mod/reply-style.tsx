import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

const narration = atom({ plugin: 'chebu-ui', key: 'narration' } as const, [])

export function registerReplyStyle(on: On) {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
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
      // A background instead of a frame, so copied text carries no border characters.
      // Wraps the drawing beneath, so another mod (gfm-render's alerts and diagrams) still gets its turn.
      <Box marginTop={1} backgroundColor="#1e2a3a" paddingX={1}>
        {await next(e)}
      </Box>
    )
  })
}
