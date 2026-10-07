import type { Register } from 'claude-code'
import { registerPromptStyle } from './prompt-style'

export const register: Register = on => {
  registerPromptStyle(on)
}
