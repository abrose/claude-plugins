import { describe, expect, test } from 'claude-code/testing'
import { promptVerdict } from '../../hooks/mod/prompt-cards'
import { goneSince, holdStep } from '../../hooks/mod/prompt-hold'
import { BASH_DIALOG_SNAPSHOT, BASH_DIALOG_TEXT, call, card, DIALOG_TEXT, envoyTeam, team } from './world'

const LINK = { agent: 'app-1-scout', role: 'investigator', session: 'sid-scout', pane: 'w1:p2', dialog: DIALOG_TEXT, at: 0 }
const record = (over: object = {}) => ({ role: 'investigator', topic: '', brief: '', pane: 'w1:p2', session: 'sid-scout', ...over })
const row = (state: string, pane = 'w1:p2') => ({ name: 'app-1-scout', state, pane })
const seen = (over: object = {}) => ({ listed: true, record: record(), row: row('blocked'), dialog: DIALOG_TEXT, ...over })
const gone = (why: string, pane = 'w1:p2') => ({
  kind: 'gone', text: `the permission prompt in the investigator's pane (${pane}) is gone: ${why}`,
})

describe('promptVerdict', () => {
  test('a linked agent still blocked on the same dialog shows its prompt', () => {
    expect(promptVerdict(LINK, seen())).toEqual({ kind: 'shows' })
  })

  test('an agent that left blocked is gone, with its new state in the reason', () => {
    expect(promptVerdict(LINK, seen({ row: row('idle'), dialog: '' }))).toEqual(gone('the agent is now idle'))
    expect(promptVerdict(LINK, seen({ row: row('working'), dialog: '' }))).toEqual(gone('the agent is now working'))
  })

  test('a different dialog on the same agent is gone: a new prompt, and the verdict carries the new dialog', () => {
    expect(promptVerdict(LINK, seen({ dialog: 'Bash command / ls / Do you want to proceed?' })))
      .toEqual({ ...gone('a different prompt shows there'), next: 'Bash command / ls / Do you want to proceed?' })
  })

  test('a state signal carries no new dialog', () => {
    expect(promptVerdict(LINK, seen({ row: row('idle'), dialog: '' }))).not.toHaveProperty('next')
  })

  test('dialogs that differ only in whitespace are the same prompt', () => {
    expect(promptVerdict({ ...LINK, dialog: 'Bash command  /  rm -rf build' }, seen({ dialog: ' Bash command / rm -rf   build\n' })))
      .toEqual({ kind: 'shows' })
  })

  test('an empty stored or read dialog never counts as a different prompt', () => {
    expect(promptVerdict({ ...LINK, dialog: '' }, seen())).toEqual({ kind: 'shows' })
    expect(promptVerdict(LINK, seen({ dialog: '' }))).toEqual({ kind: 'shows' })
  })

  test('a new session for the record is gone: the agent moved on', () => {
    expect(promptVerdict(LINK, seen({ record: record({ session: 'sid-new' }) })))
      .toEqual(gone('the agent started a new session'))
  })

  test('a record that no longer exists is gone: released, named from the stored link', () => {
    expect(promptVerdict(LINK, seen({ record: undefined, row: undefined })))
      .toEqual(gone('the agent was released'))
  })

  test('a pane herdr no longer lists is gone', () => {
    expect(promptVerdict(LINK, seen({ row: row('gone') }))).toEqual(gone('the pane is gone'))
  })

  test('a herdr listing that failed is unknown, whatever the row says', () => {
    expect(promptVerdict(LINK, seen({ listed: false, row: row('?') }))).toEqual({ kind: 'unknown' })
  })

  test('a herdr state of unknown is no verdict: herdr cannot classify the agent, so the prompt may still show', () => {
    expect(promptVerdict(LINK, seen({ row: row('unknown'), dialog: '' }))).toEqual({ kind: 'unknown' })
  })

  test('the reason names the pane herdr reports now', () => {
    expect(promptVerdict(LINK, seen({ row: row('idle', 'w1:p9'), dialog: '' })))
      .toEqual(gone('the agent is now idle', 'w1:p9'))
  })
})

describe('holdStep', () => {
  test('gone on one tick does not close; gone on two ticks in a row closes', () => {
    expect(holdStep('Q-1', true, 10).due).toBe(false)
    expect(holdStep('Q-1', true, 25).due).toBe(true)
  })

  test('shows or unknown between two gone ticks starts the count over', () => {
    expect(holdStep('Q-2', true, 10).due).toBe(false)
    expect(holdStep('Q-2', false, 25).due).toBe(false)
    expect(holdStep('Q-2', true, 40).due).toBe(false)
    expect(holdStep('Q-2', true, 55).due).toBe(true)
  })

  test('remembers since when the prompt looks gone, until a tick shows it again', () => {
    holdStep('Q-3', true, 10)
    holdStep('Q-3', true, 25)
    expect(goneSince('Q-3')).toBe(10)
    holdStep('Q-3', false, 40)
    expect(goneSince('Q-3')).toBeUndefined()
  })
})

describe('a linked card in the envoy session', () => {
  const ticks = async (w: any, n: number) => {
    for (let i = 0; i < n; i++) await w.clock.advance(15000)
  }
  const ORCH = { pane_id: 'w1:p1', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }
  const scout = (state: string) => ({ pane_id: 'w1:p2', agent_status: state, agent_session: { value: 'sid-scout' } })
  const HEAD = '# Decisions APP-1\nNumbered, dated, one paragraph each. Amendments: 3a replaces 3, 5a amends 5.\nEvery brief reads this file first. Only the envoy writes it, through the `decide` tool.\n'
  const decisionsFile = (w: any) => `${w.cwd}/scratchpad/current/decisions-APP-1.md`
  const filed = (w: any, n = 1) => w.json(`${w.team}/questions/Q-${n}.json`)
  const REASON = (why: string) =>
    `Closed by the team mod: the permission prompt in the investigator's pane (w1:p2) is gone: ${why}.`

  /** An envoy session with card Q-1 about the scout's prompt; the scout is blocked on the dialog the card holds. */
  async function blocked($: any, on: any) {
    const w = await envoyTeam($, on)
    w.write(decisionsFile(w), HEAD)
    w.agents = [ORCH, scout('blocked')]
    card(w, 1, { urgent: true, prompt: { ...LINK, at: w.clock.now() } })
    await ticks(w, 1)
    return w
  }

  test('closes as obsolete with the reason and closed_by, two ticks after its agent leaves blocked', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]

    await ticks(w, 1)
    expect(filed(w).status).toBe('open')
    await ticks(w, 1)

    expect(filed(w)).toMatchObject({
      status: 'obsolete', reason: REASON('the agent is now idle'), closed_by: 'team mod',
    })
    expect(filed(w).next_dialog).toBeUndefined()
  })

  test('stays open while its agent stays blocked on the same dialog', async ($, on) => {
    const w = await blocked($, on)

    await ticks(w, 6)

    expect(filed(w).status).toBe('open')
  })

  test('herdr down for a tick never closes a linked card', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]
    await ticks(w, 1)
    w.herdrFails = 'server_unavailable'
    await ticks(w, 1)
    w.herdrFails = null

    await ticks(w, 1)
    expect(filed(w).status).toBe('open')
    await ticks(w, 1)

    expect(filed(w).status).toBe('obsolete')
  })

  test('an agent herdr reports as unknown never closes the card, however long it stays so', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('unknown')]

    await ticks(w, 6)

    expect(filed(w).status).toBe('open')
  })

  test('a card without a prompt link is never closed by the mod', async ($, on) => {
    const w = await envoyTeam($, on)
    w.agents = [ORCH, scout('idle')]
    card(w, 1)

    await ticks(w, 6)

    expect(filed(w)).toMatchObject({ status: 'open' })
    expect(filed(w).closed_by).toBeUndefined()
  })

  test('a different prompt in the same pane closes the card, a one-tick flicker does not', async ($, on) => {
    const w = await blocked($, on)
    w.dialogs.set('w1:p2', BASH_DIALOG_SNAPSHOT)
    await ticks(w, 1)
    w.dialogs.delete('w1:p2')
    await ticks(w, 2)
    expect(filed(w).status).toBe('open')

    w.dialogs.set('w1:p2', BASH_DIALOG_SNAPSHOT)
    await ticks(w, 2)

    expect(filed(w)).toMatchObject({
      status: 'obsolete', reason: REASON('a different prompt shows there'), next_dialog: BASH_DIALOG_TEXT,
    })
  })

  test('a record that vanished closes the card: released', async ($, on) => {
    const w = await blocked($, on)
    w.files.delete(`${w.team}/app-1-scout.json`)
    w.agents = [ORCH]

    await ticks(w, 2)

    expect(filed(w)).toMatchObject({ status: 'obsolete', reason: REASON('the agent was released') })
  })

  test('a new session for the record closes the card', async ($, on) => {
    const w = await blocked($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, record({ session: 'sid-new' }))
    w.agents = [ORCH, { ...scout('blocked'), agent_session: { value: 'sid-new' } }]

    await ticks(w, 2)

    expect(filed(w)).toMatchObject({ status: 'obsolete', reason: REASON('the agent started a new session') })
  })

  test('a card answered by decide is not touched by the close', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]
    await ticks(w, 1)
    const decided = await call($, 'decide', { cards: ['Q-1'], answer: 'Deny it.', rationale: 'r' })
    expect(decided.result).toContain('Decision 1')

    await ticks(w, 3)

    expect(filed(w)).toMatchObject({ status: 'answered', decision: 1 })
    expect(filed(w).closed_by).toBeUndefined()
  })

  test('decide inside the hold window records the decision and notes, in local time, that the prompt looks gone', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]
    await ticks(w, 1)
    const at = new Date(w.clock.now())
    const two = (n: number) => String(n).padStart(2, '0')
    const since = `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`

    const r = await call($, 'decide', { cards: ['Q-1'], answer: 'Deny it.', rationale: 'r' })

    expect(r.isError).toBeUndefined()
    expect(r.result).toBe(`Decision 1\nNote: the permission prompt behind Q-1 looks gone since ${since}.`)
  })

  test('decide on a card whose prompt still shows adds no note', async ($, on) => {
    await blocked($, on)

    const r = await call($, 'decide', { cards: ['Q-1'], answer: 'Allow it.', rationale: 'r' })

    expect(r).toMatchObject({ result: 'Decision 1' })
  })

  test('decide after the close refuses: Q-1 is already obsolete', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]
    await ticks(w, 2)

    expect(await call($, 'decide', { cards: ['Q-1'], answer: 'Deny it.', rationale: 'r' }))
      .toMatchObject({ isError: true, result: 'Q-1 is already obsolete' })
  })

  test('a decide and a close in the same tick run one at a time: the first wins, no write is lost', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]
    await ticks(w, 1)

    const [decided] = await Promise.all([
      call($, 'decide', { cards: ['Q-1'], answer: 'Deny it.', rationale: 'r' }),
      ticks(w, 1),
    ])

    const final = filed(w)
    if (decided.isError) {
      expect(decided.result).toBe('Q-1 is already obsolete')
      expect(final).toMatchObject({ status: 'obsolete', closed_by: 'team mod' })
      expect(w.files.get(decisionsFile(w))!.text).toBe(HEAD)
    } else {
      expect(final).toMatchObject({ status: 'answered', decision: 1 })
      expect(final.closed_by).toBeUndefined()
    }
  })

  test('the close writes nothing to the decisions file or the ledger', async ($, on) => {
    const w = await blocked($, on)
    w.agents = [ORCH, scout('idle')]

    await ticks(w, 3)

    expect(filed(w).status).toBe('obsolete')
    expect(w.files.get(decisionsFile(w))!.text).toBe(HEAD)
    expect([...w.files.keys()].filter(p => p.startsWith(`${w.team}/decisions/`))).toEqual([])
  })

  test('a single-session run closes linked cards too', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    card(w, 1, { urgent: true, prompt: { ...LINK, at: w.clock.now() } })
    await ticks(w, 1)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]

    await ticks(w, 2)

    expect(filed(w)).toMatchObject({ status: 'obsolete', reason: REASON('the agent is now idle'), closed_by: 'team mod' })
  })

  test('the orchestrator half tells the orchestrator once with a WATCH line', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    card(w, 1, { urgent: true, prompt: { ...LINK, at: w.clock.now() } })
    await ticks(w, 1)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]

    await ticks(w, 6)

    const lines = w.submits.flatMap((s: string) => s.split('\n')).filter((l: string) => l.startsWith('WATCH Q-1'))
    expect(lines).toEqual([
      "WATCH Q-1 closed (app-1-scout): the permission prompt in the investigator's pane (w1:p2) is gone: the agent is now idle",
    ])
  })

  test('a second prompt right after the first reaches the orchestrator: the closed line carries the new dialog and the prompt_of hint', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    card(w, 1, { urgent: true, prompt: { ...LINK, at: w.clock.now() } })
    await ticks(w, 1)
    w.dialogs.set('w1:p2', BASH_DIALOG_SNAPSHOT)

    await ticks(w, 6)

    const lines = w.submits.flatMap((s: string) => s.split('\n')).filter((l: string) => l.startsWith('WATCH'))
    expect(lines).toEqual([
      "WATCH Q-1 closed (app-1-scout): the permission prompt in the investigator's pane (w1:p2) is gone: " +
        `a different prompt shows there; it is now blocked on a new prompt: ${BASH_DIALOG_TEXT} - ` +
        'a card about this prompt sets prompt_of: app-1-scout',
    ])
  })
})
