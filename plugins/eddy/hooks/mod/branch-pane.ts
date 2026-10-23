import type { PromptSubmitInput } from 'claude-code'
import type { BranchHome } from './branches'
import type { Io, ToolResult } from './io'

const NOT_BUILT = 'pane mode not built yet'

/** The pane home: the branch lives in a separate session. T6 fills every method; until then each refuses. */
export const paneHome: BranchHome = {
  busy: async () => ({ refused: NOT_BUILT }),
  collect: async () => ({ refused: NOT_BUILT }),
  enter: async () => ({ refused: NOT_BUILT }),
  leave: async () => ({ refused: NOT_BUILT }),
}

// The hooks T6 fills. eddy.tsx already calls them, so T6 does not touch it. Each one does nothing until then.

/** A turn of a session ended: T6 copies the discussant's rows into the branch record. */
export async function paneOnTurnComplete(_io: Io): Promise<void> {}

/** A prompt is about to enter: T6 returns the reason when it must not (a person typed in a pane that no longer owns the branch). */
export async function paneDropPrompt(_io: Io, _prompt: PromptSubmitInput): Promise<string | null> {
  return null
}

/** A `decide` call is about to run: T6 returns the refusal when the caller is a branch session. */
export async function paneDecideGuard(_io: Io): Promise<ToolResult | null> {
  return null
}

/** The envoy tick: T6 fills the prompt box with the answer a pane branch settled with. */
export async function paneFill(_io: Io, _fill: (text: string) => Promise<boolean>): Promise<void> {}
