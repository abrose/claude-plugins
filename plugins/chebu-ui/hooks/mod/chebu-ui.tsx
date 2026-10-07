import type { Register } from 'claude-code'
import { registerNotes } from './notes'
import { PROMPTS_COMMAND, registerPromptLog } from './prompt-log'
import { PROMPT_STYLE_COMMAND, registerPromptStyle } from './prompt-style'
import { registerQuietTools } from './quiet-tools'
import { registerReplyStyle } from './reply-style'
import { registerTurnSeparator } from './turn-separator'

export const register: Register = on => {
  // A mod holds one session.start hook, so every command registers here.
  on('session.start', async ($, e, next) => {
    await $.command.register(PROMPT_STYLE_COMMAND)
    await $.command.register(PROMPTS_COMMAND)

    return next(e)
  })

  registerNotes(on)
  registerPromptStyle(on)
  registerPromptLog(on)
  registerTurnSeparator(on)
  registerQuietTools(on)
  registerReplyStyle(on)
}
