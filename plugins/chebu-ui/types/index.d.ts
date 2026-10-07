export type PromptStyle = 'box' | 'banner' | 'gutter' | 'label' | 'double'

/**
 * One own prompt of this session: its text, when it was sent (epoch ms), and whether it still
 * waits behind a running turn.
 */
export type SentPrompt = { text: string; at: number; queued?: boolean }

/** One finished turn: its duration as turn.complete reported it, and when it ended (epoch ms). */
export type TurnEnd = { durationMs: number; at: number }

declare module 'claude-code' {
  interface PluginState {
    'chebu-ui': {
      promptStyle: PromptStyle
      /** Own prompts of this session, in the order sent; a prompt's number is its place here plus one. */
      sent: SentPrompt[]
      /** Finished turns of this session, in order. */
      turnEnds: TurnEnd[]
      /** Reply blocks (trimmed) a tool call followed in the same turn: narration, drawn dim. */
      narration: string[]
    }
  }
}
