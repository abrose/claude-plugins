import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { isOwn, PROMPT_PANE } from './state'

/**
 * Every state write of the mod. Drawing may not write state, a mod holds one hook per event
 * without a matcher, and $ is never followed across an import, so the event hooks that note
 * what the drawings read all live here; the feature files only draw.
 */

const sent = atom({ plugin: 'chebu-ui', key: 'sent' } as const, [])
const turnEnds = atom({ plugin: 'chebu-ui', key: 'turnEnds' } as const, [])
const narration = atom({ plugin: 'chebu-ui', key: 'narration' } as const, [])

type Block = { type?: string; text?: string }

/** A queued prompt stops waiting once it enters the conversation: as a new turn, or delivered into the running one. */
async function deliver($: EngineInterface, has: (text: string) => boolean) {
  const list = await read($, sent)
  if (list.some(one => one.queued === true && has(one.text))) {
    await update($, sent, all => all.map(one => (one.queued === true && has(one.text) ? { ...one, queued: false } : one)))
  }
}

/** Brings a new prompt into view in an open prompt pane, even after the person scrolled up. */
async function revealNewest($: EngineInterface) {
  try {
    if ((await $.ui.panes()).some(pane => pane.id === PROMPT_PANE)) {
      await $.ui.scroll({ in: PROMPT_PANE, to: 'end' })
    }
  } catch {
    // Scrolling is cosmetic: a host without it (the test kit) must not lose the prompt note.
  }
}

export function registerNotes(on: On) {
  // Reply text of the running turn not yet followed by a tool call: the answer, unless a tool call comes.
  let pending: string[] = []

  on('prompt.submit', async ($, e, next) => {
    if (isOwn(e.origin)) {
      const at = await $.clock.now()
      // A turnId means a turn was running as the prompt was sent, so it waits behind that turn.
      const queued = e.turnId !== undefined
      await update($, sent, list => [...list, { text: e.text, at, queued }])
      await revealNewest($)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    pending = []
    await deliver($, text => text === e.text)

    return next(e)
  })

  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const row = JSON.stringify(e.message)
    await deliver($, text => row.includes(JSON.stringify(text).slice(1, -1)))

    if (e.message.type === 'assistant' && Array.isArray(e.message.content)) {
      for (const block of e.message.content as Block[]) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          pending.push(block.text.trim())
        } else if (block.type === 'tool_use' && pending.length > 0) {
          const said = pending
          pending = []
          await update($, narration, list => [...list, ...said].slice(-1000))
        }
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    pending = []
    const at = await $.clock.now()
    await update($, turnEnds, list => [...list, { durationMs: e.durationMs, at }].slice(-500))

    return next(e)
  })
}
