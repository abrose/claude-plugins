import type { On } from 'claude-code'

/** Tools whose engine row carries something to read (a diff, a question, a subagent): left as drawn. */
const LOUD = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'AskUserQuestion', 'Agent', 'ExitPlanMode'])
const SUMMARY_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt']
const RESULT_LINES = 3

function summary(input: unknown) {
  if (typeof input !== 'object' || input === null) {
    return ''
  }

  const fields = input as Record<string, unknown>
  const key = SUMMARY_KEYS.find(k => typeof fields[k] === 'string')
  const value = key !== undefined ? fields[key] : Object.values(fields).find(v => typeof v === 'string')

  return typeof value === 'string' ? value.replace(/\s+/g, ' ') : ''
}

export function registerQuietTools(on: On) {
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    if (LOUD.has(e.props.tool) || e.props.isErrored || e.props.isInterrupted) {
      return next(e)
    }

    const { Text } = $.ui.resolve(e)
    const mark = e.props.isRunning ? '…' : '·'

    return (
      <Text dimColor wrap="truncate-end">
        {`  ${mark} ${e.props.tool} ${summary(e.props.input)}`}
      </Text>
    )
  })

  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    if (e.props.tool !== 'Bash' || e.props.isErrored) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const output = e.props.output as { stdout?: string; stderr?: string }
    const lines = `${output.stdout ?? ''}${output.stderr ?? ''}`.trimEnd().split('\n').filter(l => l !== '')
    const more = lines.length - RESULT_LINES

    return (
      <Box flexDirection="column" paddingLeft={4}>
        {lines.length === 0 && <Text dimColor>(no output)</Text>}
        {lines.slice(0, RESULT_LINES).map(line => (
          <Text dimColor wrap="truncate-end">{line}</Text>
        ))}
        {more > 0 && <Text dimColor italic>{`… ${more} more lines (ctrl+o)`}</Text>}
      </Box>
    )
  })
}
