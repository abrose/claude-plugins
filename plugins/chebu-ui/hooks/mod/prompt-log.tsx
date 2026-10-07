import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { clockTime, PROMPT_PANE as PANE, shownText } from './state'

/** A prompt that wraps to more rows than this is folded: its first rows, then a count of the rest. */
const MAX_ROWS = 5
const sent = atom({ plugin: 'chebu-ui', key: 'sent' } as const, [])
const unfolded = atom({ plugin: 'chebu-ui', key: 'unfolded' } as const, [])

export const PROMPTS_COMMAND = {
  name: 'prompts',
  description: 'Show or hide the prompts you sent this session in a pane',
}

/** The fold button's column after the time: the arrow and a space. */
const FOLD_WIDTH = 2
/** The empty cells right of each prompt's text. */
const RIGHT_PAD = 2

/**
 * The text as the pane shows it in rows of `width`, each line wrapping on its own: whole, or cut
 * to MAX_ROWS - 1 rows, the last row left to the line that counts the hidden rows.
 */
function fold(text: string, width: number, isUnfolded: boolean) {
  const lines = text.split('\n')
  const rowsOf = (line: string) => Math.ceil(line.length / width) || 1
  const rows = lines.reduce((sum, line) => sum + rowsOf(line), 0)
  if (rows <= MAX_ROWS) {
    return { text, hidden: 0 }
  }
  const hidden = rows - (MAX_ROWS - 1)
  if (isUnfolded) {
    return { text, hidden }
  }

  const kept: string[] = []
  let room = MAX_ROWS - 1
  for (const line of lines) {
    if (room === 0) {
      break
    }
    if (rowsOf(line) <= room) {
      kept.push(line)
      room -= rowsOf(line)
    } else {
      kept.push(`${line.slice(0, room * width - 1)}…`)
      room = 0
    }
  }

  return { text: kept.join('\n'), hidden }
}

/** `───── N more lines hidden ─────`, a rule as wide as the text column. */
function hiddenRule(hidden: number, width: number) {
  const label = ` ${hidden} more lines hidden `
  const left = Math.max(2, Math.floor((width - label.length) / 2))
  const right = Math.max(2, width - label.length - left)

  return `${'─'.repeat(left)}${label}${'─'.repeat(right)}`
}

/**
 * A prompt's text as the pane shows it. Text copied from a framed terminal box carries the frame's
 * `│` at each line's edges and the padding before it; both would wrap as rows of their own.
 */
function paneText(text: string) {
  return shownText(text)
    .replace(/\r\n?/g, '\n')
    .replace(/^│ ?/gm, '')
    .replace(/[ \t]*│$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .trimEnd()
}

/** Moves the pane's window; scrolling is cosmetic, so a window that cannot move fails nothing. */
async function reveal($: EngineInterface, to: 'end' | { key: string }) {
  try {
    await $.ui.scroll({ in: PANE, to })
  } catch {
    // An unplaced pane, or a host without scrolling (the test kit): the list still draws.
  }
}

async function toggleFold($: EngineInterface, n: number) {
  await update($, unfolded, list => (list.includes(n) ? list.filter(one => one !== n) : [...list, n]))
  // Folding can pull the prompt's button out of the window; keep it where the press was.
  await reveal($, { key: `fold:${n}` })
}

/** Closes the prompt pane when it shows, else opens it or brings it out from behind another tab. */
async function togglePane($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (pane?.isShown === true) {
    await $.ui.close({ id: PANE })

    return 'closed'
  }
  if (pane !== undefined) {
    // Opening an open id only retitles it; a fresh open seats it in front.
    await $.ui.close({ id: PANE })
  }
  await $.ui.open({ id: PANE, title: 'My prompts' })
  // The end follows the tree as it grows, so the newest prompt stays in view.
  await reveal($, 'end')

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
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, sent)
    const open = await read($, unfolded)
    const tagWidth = `#${all.length} `.length
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 80
    const textWidth = Math.max(10, columns - tagWidth - 'HH:MM '.length - FOLD_WIDTH - RIGHT_PAD)
    const list = all.map((one, i) => {
      const n = i + 1
      const queued = one.queued === true
      const isUnfolded = open.includes(n)
      // The queued mark takes two cells of the first row.
      const text = `${queued ? '⏳ ' : ''}${paneText(one.text)}`

      return { n, time: clockTime(one.at), queued, isUnfolded, ...fold(text, textWidth, isUnfolded) }
    })

    // Every prompt is drawn; the pane's body scrolls over a taller list, its window kept at the end.
    return (
      <Box flexDirection="column" rowGap={1}>
        {list.length === 0 && <Text dimColor>No prompts yet.</Text>}
        {list.map(({ n, time, text, queued, hidden, isUnfolded }) => (
          <Box flexDirection="row">
            <Box flexShrink={0} width={tagWidth}>
              <Text color={queued ? 'yellow' : 'green'} bold>{`#${n}`}</Text>
            </Box>
            <Box flexShrink={0} width={6}>
              <Text color="gray">{time}</Text>
            </Box>
            {/* Every row keeps the fold column, so the texts line up whether a prompt folds or not. */}
            <Box flexShrink={0} width={FOLD_WIDTH}>
              {hidden > 0 && (
                <Button
                  key={`fold:${n}`}
                  label={isUnfolded ? '▼' : '▶'}
                  plain
                  onPress={() => toggleFold($, n)}
                />
              )}
            </Box>
            <Box flexGrow={1} flexShrink={1} flexDirection="column" paddingRight={RIGHT_PAD}>
              <Text wrap="wrap" color={queued ? 'yellow' : undefined} italic={queued}>
                {text}
              </Text>
              {hidden > 0 && !isUnfolded && (
                <Text key={`hidden:${n}`} dimColor>
                  {hiddenRule(hidden, textWidth)}
                </Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
