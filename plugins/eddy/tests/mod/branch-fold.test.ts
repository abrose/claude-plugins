import { describe, expect, test } from 'claude-code/testing'
import { foldHome, rowsAfterMark } from '../../hooks/mod/branch-fold'
import { call, card as fileCard, envoyTeam } from './world'

const TICK = 15000
const ticks = async (w: any, n: number) => {
  for (let i = 0; i < n; i++) await w.clock.advance(TICK)
}
const pushes = (w: any): string[] => w.submits.filter((s: string) => s.startsWith('NEXT-ACTION'))
const ORCH = { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }
const SCOUT = { pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }
const branchPath = (w: { team: string }, id = 'B-1') => `${w.team}/branches/${id}.json`
const decisionsFile = (w: any) => `${w.cwd}/scratchpad/eddy/current/decisions-APP-1.md`

const MARK = 'EDDY-BRANCH-OPEN B-1 on Q-3'
const OPEN_TEXT = `${MARK}\nThe branch is open here. News waits until you close it.`
type Row = { role: 'user' | 'assistant'; text: string; toolUses: any[]; toolResults?: any[] }
// The engine checks the shape of the messages a compact carries: `toolUses` is a list, a result has an id.
const user = (text: string): Row => ({ role: 'user', text, toolUses: [] })
const assistant = (text: string): Row => ({ role: 'assistant', text, toolUses: [] })
/** The user row the engine builds for a tool result: no text of its own, the result in `toolResults`. */
const result = (text: string): Row => ({
  role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't0', text, isError: false }],
})

/** An envoy session with the orchestrator and the scout idle in herdr and card Q-3 open, one tick past its baseline. */
async function envoyWithCard($: any, on: any) {
  const w = await envoyTeam($, on)
  w.agents = [ORCH, SCOUT]
  fileCard(w, 3)
  await ticks(w, 1)
  return w
}

describe('rowsAfterMark', () => {
  test('rowsAfterMark finds the marker in a tool result and returns the rows after it', () => {
    const rows = rowsAfterMark([
      user('trunk talk'),
      assistant('trunk answer'),
      user('let us talk about Q-3'),
      result(OPEN_TEXT),
      assistant('Which fixtures do you prefer?'),
      user('the real ones'),
    ], MARK, 7)

    expect(rows).toEqual([
      { role: 'assistant', text: 'Which fixtures do you prefer?', at: 7 },
      { role: 'human', text: 'the real ones', at: 7 },
    ])

    // The marker is found in a tool use text and in the message text as well.
    const inUse: Row = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'x', input: {}, text: MARK }] }
    expect(rowsAfterMark([user('a'), inUse, user('after use')], MARK, 1).map(r => r.text)).toEqual(['after use'])
    expect(rowsAfterMark([user(`${MARK} (moved)`), assistant('after text')], MARK, 1).map(r => r.text))
      .toEqual(['after text'])
  })

  test('rowsAfterMark takes the newest marker when the branch moved back and forth', () => {
    const rows = rowsAfterMark([
      result(OPEN_TEXT),
      assistant('first stretch'),
      user('first answer'),
      user(`EDDY-BRANCH-OPEN B-1 on Q-3 (moved from the pane)`),
      assistant('second stretch'),
    ], MARK, 1)

    expect(rows.map(r => r.text)).toEqual(['second stretch'])
  })

  test('rowsAfterMark drops NEXT-ACTION rows', () => {
    const rows = rowsAfterMark([
      result(OPEN_TEXT),
      user('NEXT-ACTION from the eddy mod. Tell the human only what changed, in your own words'),
      assistant('Q-9 is blocked'),
      user('what about the fixtures?'),
    ], MARK, 1)

    expect(rows.map(r => r.text)).toEqual(['Q-9 is blocked', 'what about the fixtures?'])
  })

  test('rowsAfterMark answers no rows when the marker is gone', () => {
    const rows = rowsAfterMark([user('trunk talk'), assistant('trunk answer'), user('more trunk')], MARK, 1)

    expect(rows).toEqual([])
  })
})

describe('the fold home', () => {
  const rec = (fields: object = {}) => ({
    id: 'B-1', n: 1, card: 'Q-3', mode: 'fold', owner: 'sid-envoy', envoy: 'sid-envoy', state: 'open',
    mark: MARK, opened_by: '', base: 0, history: [], ...fields,
  }) as never
  const fakeIo = (messages: Row[]) => ({ messages: async () => messages, now: async () => 5000 }) as never

  test('collect keeps the rows before base and adds the rows after the marker', async () => {
    const kept = [
      { role: 'human', text: 'from the pane', at: 1 },
      { role: 'assistant', text: 'dropped by base', at: 2 },
    ]
    const r = await foldHome.collect(rec({ base: 1, history: kept }), fakeIo([
      user('trunk'), result(OPEN_TEXT), assistant('back in the chat'), user('yes'),
    ]))

    expect(r).toEqual([
      { role: 'human', text: 'from the pane', at: 1 },
      { role: 'assistant', text: 'back in the chat', at: 5000 },
      { role: 'human', text: 'yes', at: 5000 },
    ])
    // busy and leave let go: the caller is the envoy turn itself.
    expect(await foldHome.busy(rec(), fakeIo([]))).toBeNull()
    expect(await foldHome.leave(rec(), fakeIo([]))).toBeNull()
  })
})

describe('a fold branch in the envoy session', () => {
  const TALK: Row[] = [
    user('let us talk about the fixtures question'),
    result(OPEN_TEXT),
    assistant('Real fixtures cost 1 h, the snapshot hides the bug. Which one?'),
    user('real fixtures, but what does the loader swap cost?'),
    assistant('About 1 h. Nothing else changes.'),
    user('good, take real fixtures'),
  ]

  test('an auto compact while a fold branch is open passes and first writes the rows into history', async ($, on) => {
    // The engine's bottom of a compaction. A veto flag stands for another plugin's PreCompact hook.
    const reached: string[] = []
    let veto = false
    on('session.compact', (_$, e) => {
      reached.push(e.trigger)
      return veto ? { skip: 'a PreCompact hook blocked it' } : { messages: e.messages }
    })
    const w = await envoyWithCard($, on)
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    const opened = w.json(branchPath(w))

    // A veto below leaves the record as it was: the transcript is intact, the old marker still finds the rows.
    veto = true
    const vetoed = await $.session.compact({ trigger: 'auto', messages: TALK } as never)
    expect(vetoed.skip).toContain('PreCompact')
    expect(w.json(branchPath(w))).toEqual(opened)

    veto = false
    const done = await $.session.compact({ trigger: 'auto', messages: TALK } as never)

    expect(done.skip).toBeUndefined()
    expect(reached).toEqual(['auto', 'auto'])
    const after = w.json(branchPath(w))
    expect(after.history.map((r: any) => [r.role, r.text])).toEqual([
      ['assistant', 'Real fixtures cost 1 h, the snapshot hides the bug. Which one?'],
      ['human', 'real fixtures, but what does the loader swap cost?'],
      ['assistant', 'About 1 h. Nothing else changes.'],
      ['human', 'good, take real fixtures'],
    ])
    expect(after.base).toBe(4)
    // A fresh marker, because the old one goes with the compacted transcript. It still names the branch.
    expect(after.mark).not.toBe(MARK)
    expect(after.mark.startsWith(MARK)).toBe(true)
  })

  test('an auto compact passes on when the snapshot throws', async ($, on) => {
    const reached: string[] = []
    on('session.compact', (_$, e) => {
      reached.push(e.trigger)
      return { messages: e.messages }
    })
    const w = await envoyWithCard($, on)
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    const opened = w.json(branchPath(w))

    // The snapshot cannot write the record. The compact must still happen, with the record as it was.
    w.writeFailsAt.add(`${w.team}/branches/`)
    const done = await $.session.compact({ trigger: 'auto', messages: TALK } as never)
    w.writeFailsAt.clear()

    expect(done.skip).toBeUndefined()
    expect(reached).toEqual(['auto'])
    expect(w.json(branchPath(w))).toEqual(opened)
  })

  test('a throwing compact below still undoes the snapshot', async ($, on) => {
    on('session.compact', () => {
      throw new Error('compact failed below')
    })
    const w = await envoyWithCard($, on)
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    const opened = w.json(branchPath(w))

    await expect($.session.compact({ trigger: 'auto', messages: TALK } as never)).rejects.toThrow()

    // The hook rethrew (the engine words the error its own way). The undo ran: no rows in the record, old marker back.
    expect(w.json(branchPath(w))).toEqual(opened)
  })

  test('a fold branch closes when the transcript cannot be read', async ($, on) => {
    const w = await envoyWithCard($, on)
    w.messages = [user('let us talk about the fixtures question')] as never
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    fileCard(w, 3, { status: 'answered', decision: 4 })

    w.messagesFail = true
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    w.messagesFail = false

    expect(r.isError).toBeUndefined()
    expect(r.result).toContain('Recorded as decision 4.')
    expect(r.result).toContain('The rows after the marker could not be read')
    expect(w.json(branchPath(w))).toMatchObject({ state: 'settled', history: [] })
    expect(w.dirs.has(`${w.team}/branches/open`)).toBe(false)
  })

  test('branch_close of a fold branch adds the fold hint with the opening prompt', async ($, on) => {
    const w = await envoyWithCard($, on)
    w.messages = [user('let us talk about the fixtures question')] as never
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    fileCard(w, 3, { status: 'answered', decision: 4 })
    const r = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })

    expect(r.isError).toBeUndefined()
    expect(r.result).toContain('Recorded as decision 4.')
    expect(r.result).toContain(
      'Fold the branch now: on an empty prompt press Esc twice, pick your message ' +
      '"let us talk about the fixtures question", choose Summarize from here, and type: ' +
      'keep the decision and the summary.')
  })

  test('after branch_close a manual compact is not skipped', async ($, on) => {
    const reached: string[] = []
    on('session.compact', (_$, e) => {
      reached.push(e.trigger)
      return { messages: e.messages }
    })
    const w = await envoyWithCard($, on)
    await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    const skipped = await $.session.compact({ trigger: 'manual', messages: TALK } as never)
    expect(skipped.skip).toContain('An eddy branch is open (B-1 on Q-3)')

    fileCard(w, 3, { status: 'answered', decision: 4 })
    await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'real fixtures' })
    const done = await $.session.compact({ trigger: 'manual', messages: TALK } as never)

    expect(done.skip).toBeUndefined()
    expect(reached).toEqual(['manual'])
  })

  // Decision 27: one card branch works end to end in the fold mode.
  test('a fold branch runs end to end', async ($, on) => {
    const w = await envoyWithCard($, on)
    w.write(decisionsFile(w), '# Decisions APP-1\n')
    const opening = 'let us talk about the fixtures question'
    w.messages = [user(opening)] as never

    // 1. The envoy opens the fold branch on the card. The transcript now holds the result with the marker.
    const opened = await call($, 'branch_open', { card: 'Q-3', mode: 'fold' })
    expect(opened.isError).toBeUndefined()
    expect(opened.result.split('\n')[0]).toBe(MARK)
    w.messages.push(result(opened.result) as never)

    // 2. Two discussion turns. News that arrives meanwhile waits (the hold).
    w.messages.push(
      assistant('Real fixtures cost 1 h, the snapshot hides the bug. Which one?') as never,
      user('real fixtures, but what does the loader swap cost?') as never,
      assistant('About 1 h. Nothing else changes.') as never,
      user('good, take real fixtures') as never,
    )
    fileCard(w, 4)
    await ticks(w, 4)
    expect(pushes(w)).toEqual([])
    expect(w.statuses.at(-1)).toBe('branch open on Q-3 (B-1, fold) · 1 news wait')

    // 3. The human's own answer in the chat is the one Enter of decision 18. The envoy records it.
    const decided = await call($, 'decide', {
      cards: ['Q-3'], answer: 'Use real fixtures.', rationale: 'The snapshot hides the bug.',
    })
    expect(decided).toEqual({ result: 'Decision 1' })
    w.messages.push(result(decided.result) as never)

    // 4. The envoy closes the branch. The close text has the decision number and the fold hint.
    const closed = await call($, 'branch_close', { id: 'B-1', outcome: 'settled', summary: 'we take real fixtures' })
    expect(closed.isError).toBeUndefined()
    expect(closed.result).toContain('Recorded as decision 1.')
    expect(closed.result).toContain(`pick your message "${opening}"`)
    expect(closed.result).toContain('choose Summarize from here')

    // 5. The record holds the discussion rows, and nothing from the trunk.
    const rec = w.json(branchPath(w))
    expect(rec).toMatchObject({ state: 'settled', decision: 1, summary: 'we take real fixtures' })
    expect(rec.history.map((r: any) => [r.role, r.text])).toEqual([
      ['assistant', 'Real fixtures cost 1 h, the snapshot hides the bug. Which one?'],
      ['human', 'real fixtures, but what does the loader swap cost?'],
      ['assistant', 'About 1 h. Nothing else changes.'],
      ['human', 'good, take real fixtures'],
    ])

    // 6. The hold lifts and the held news goes out in one message, once.
    await ticks(w, 3)
    expect(pushes(w)).toHaveLength(1)
    expect(pushes(w)[0]).toContain('- New card:')
    expect(pushes(w)[0]).toContain('Q-4')
    await ticks(w, 4)
    expect(pushes(w)).toHaveLength(1)
  })
})
