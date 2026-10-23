import type { EddyBranch } from '../../types'
import type { BranchHome } from './branches'

const NOT_BUILT = 'fold switch not built yet'

/** The text a fold branch opens with: the marker first, so the transcript holds it (a tool result keeps the text). */
export const foldOpenText = (rec: EddyBranch) =>
  `${rec.mark}\nThe branch is open here. News waits until you close it.`

/**
 * The fold home: the branch lives in the envoy chat. T4 builds only `enter` (the open text). T5 fills `collect`,
 * `leave` and `busy`, which refuse until then, so no fold branch moves out yet.
 */
export const foldHome: BranchHome = {
  busy: async () => ({ refused: NOT_BUILT }),
  collect: async () => ({ refused: NOT_BUILT }),
  enter: async rec => ({ owner: rec.envoy, text: foldOpenText(rec) }),
  leave: async () => ({ refused: NOT_BUILT }),
}
