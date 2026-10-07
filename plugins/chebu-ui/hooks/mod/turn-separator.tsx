import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { TurnEnd } from '../../types'
import { clockTime } from './state'

const RULE = '─'.repeat(400)
/** How far a row's durationMs may be from the one turn.complete reported and still be that turn. */
const MATCH_MS = 2000

const turnEnds = atom({ plugin: 'chebu-ui', key: 'turnEnds' } as const, [])

function duration(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function closest(ends: TurnEnd[], durationMs: number) {
  let best: TurnEnd | undefined
  for (const end of ends) {
    const off = Math.abs(end.durationMs - durationMs)
    if (off <= MATCH_MS && (best === undefined || off < Math.abs(best.durationMs - durationMs))) {
      best = end
    }
  }

  return best
}

export function registerTurnSeparator(on: On) {
  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const end = closest(await read($, turnEnds), e.props.durationMs)
    const time = end === undefined ? '' : `${clockTime(end.at)} · `

    return (
      <Box flexDirection="row" width="100%" marginTop={1}>
        <Text color="gray">{`── ${time}${e.props.word} ${duration(e.props.durationMs)} `}</Text>
        <Box flexGrow={1}>
          <Text color="gray" wrap="truncate-end">{RULE}</Text>
        </Box>
      </Box>
    )
  })
}
