# Team Question Queue and Envoy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open questions become durable cards in a queue that workers fill with `ask`, a pull-driven envoy session (the human's own) closes them with `decide`, and the orchestrator runs as a worker that gets each decision once as a DECISION line.

**Architecture:** The team mod (`plugins/team/hooks/mod/`) gains a role per session: `orchestrator_session` runs the push half (watch, reports, DECISION lines, layout), `envoy_session` runs the pull half (the `team` and `questions` panes, the urgent badge, the envoy-only tools). A team dir without `envoy_session` runs both halves in the orchestrator session, as today. Cards are JSON files under `.team/questions/`, decisions are appended to the numbered decisions file and kept as a ledger under `.team/decisions/`. Pure rules (card checks, queue order, decision numbering, DECISION lines, badge text) take plain data; `team.tsx` keeps every hook and builds the `Io`.

**Tech Stack:** Claude Code function hooks (TypeScript/TSX, `claude plugin validate`, `claude plugin test`), bash, Python 3 (`tests/test_team.py`, `unittest`), herdr CLI (`tests/fake-herdr`).

**Spec:** `docs/superpowers/specs/2026-10-07-team-envoy-and-question-queue-design.md` (binding with `scratchpad/current/decisions-team-envoy.md`, decisions 1-5).

## Global Constraints

- Minimum Claude Code version: `2.1.287` today. Open question 1 asks to raise it to `2.1.292`, the build the UI probe ran on. Task 7 Step 6 changes it only on Chebu's answer.
- One tick every `15000` ms drives both halves. No new timer.
- Card file: `.team/questions/Q-<n>.json`. Id claims: `.team/questions/claims/<n>` (directories, made with `mkdir`, which fails when the path exists). Ledger: `.team/decisions/<n>.json`. Toast marks: `.team/toasted.json`.
- Card `door`: exactly `one-way` or `two-way`. Card `status`: `open`, `assumed`, `answered`, `obsolete`.
- Tool names (`$.tool.register`, listed as `mcp__team__<name>`): `ask`, `queue`, `decide`, `relay`. `brief_send` stays orchestrator-only.
- Pane ids (decision 3): `team` (title `Team`) and `questions` (title `Questions`). Store key for hiding stays `overviewHidden:<team_id>`; the toggle stays `/team-overview` (decision 5).
- The mod never switches the shown tab (decision 4). Urgent badge: `$.ui.status` text; one `$.ui.toast` per new urgent card; neither calls `$.prompt.submit`.
- Line order in one orchestrator prompt: REPORT lines, then DECISION lines, then WATCH lines.
- Decision mark: key `_decision` in `.team/delivered.json` (an agent name always starts with a letter, so the key never clashes).
- No mocking library, no monkey patching. Bash tests use `tests/fake-herdr`; mod tests answer `$` events from `tests/mod/world.ts`.
- Test output must be pristine. Before a task ends, both suites are green: `python3 plugins/team/tests/test_team.py` and `claude plugin test plugins/team`.
- Never commit or stage. Each task ends with a checkpoint: show Chebu the diff; Chebu commits.
- Never use the em dash in any file or message. Use `-`.
- Comments: minimal, evergreen, no ticket ids, no "new"/"improved".
- Bash follows the `writing-bash-scripts` skill; match the style of the surrounding script.
- Shell commands in this plan follow protocol rule 20: one simple command, no pipes, no `&&`.

## Review Focus

1. **A team dir from before this change (no `envoy_session` in `config.json`):** expected the orchestrator session runs both halves: it opens the panes, sends REPORT, DECISION and WATCH lines, and accepts `queue` and `decide`; `relay` refuses. Tests in Task 2 (`queue`), Task 3 (`decide`), Task 8 (`relay`) and Task 9 (both halves).
2. **Two cards closed by one `decide`:** expected one decision number, one paragraph in the decisions file naming both cards, both cards `answered` with that number, one DECISION line naming both. A bad card in the list writes nothing at all. Tests in Task 3 and Task 4.
3. **A DECISION across an orchestrator `/clear`:** expected the decision is sent exactly once: not again after the `/clear`, and a decision made right after the `/clear` is sent once. Test in Task 4.
4. **`decide` or `relay` called outside the envoy session (the orchestrator, a worker):** expected an error naming the envoy session, no file written, nothing sent. Tests in Task 3 and Task 8.
5. **Two workers call `ask` in the same instant (two processes):** expected two distinct ids; neither card overwrites the other. Test in Task 1.

---

## File Structure

| Path | Responsibility |
|---|---|
| `plugins/team/hooks/mod/cards.ts` | card checks, card building, queue grouping and order (pure) |
| `plugins/team/hooks/mod/questions.ts` | card store over `io`: claim an id, read and write cards; the `ask` tool |
| `plugins/team/hooks/mod/decide.ts` | the `decide` and `queue` tools; decision numbering and the paragraph (numbering pure) |
| `plugins/team/hooks/mod/decisions.ts` | DECISION lines and their pickup mark (pure) |
| `plugins/team/hooks/mod/relay.ts` | the `relay` tool |
| `plugins/team/hooks/mod/badge.ts` | urgent badge text and new urgent cards (pure) |
| `plugins/team/hooks/mod/activation.ts` | `roleOf`, `envoyConfig`, follows `/clear` for both roles |
| `plugins/team/hooks/mod/pane.tsx` | the `team` and `questions` pane drawings |
| `plugins/team/hooks/mod/tick.ts` | records, report pickup, watch; skips the orchestrator record |
| `plugins/team/hooks/mod/team.tsx` | every hook; the tick split into the orchestrator half and the envoy half |
| `plugins/team/types/index.d.ts` | state contract: adds `TeamCard`, `cards`, `urgent` |
| `plugins/team/tests/mod/world.ts` | adds mkdir, `ui.status`, `ui.toast`, failed sends, role helpers |
| `plugins/team/tests/mod/{ask,queue,decide,decisions,roles,badge,relay}.test.ts` | mod tests |
| `plugins/team/bin/team-start` | role `orchestrator` |
| `plugins/team/bin/team-init` | envoy start path |
| `plugins/team/agents/team-orchestrator.md`, `agents/team-envoy.md` | agent files |
| `plugins/team/skills/team-role-envoy/SKILL.md` | envoy role rules |
| `plugins/team/commands/init.md` | `/team:init` in the envoy session |
| `plugins/team/skills/team-orchestration/SKILL.md`, role skills, templates | protocol rule changes |
| `plugins/team/SPEC.md`, `README.md` | increment |

---

## Build step 1: cards and `ask`

### Task 1: Card store and the `ask` tool

**Files:**
- Create: `plugins/team/hooks/mod/cards.ts`, `plugins/team/hooks/mod/questions.ts`
- Modify: `plugins/team/hooks/mod/io.ts`, `plugins/team/hooks/mod/brief.ts`, `plugins/team/hooks/mod/team.tsx`, `plugins/team/types/index.d.ts`
- Modify: `plugins/team/tests/mod/world.ts`
- Test: `plugins/team/tests/mod/ask.test.ts`

**Interfaces:**
- Produces:
  - `types/index.d.ts`: `export type TeamCardOption = { option: string; cost: string }` and
    `export type TeamCard = { id: string; n: number; from: string; tag: string; context: string; question: string; options: TeamCardOption[]; recommendation: string; blocks: string; door: 'one-way' | 'two-way'; rework: string; urgent: boolean; refs: string[]; status: 'open' | 'assumed' | 'answered' | 'obsolete'; decision?: number; reason?: string; at: number }`.
  - `io.ts`: `export type ToolResult = { result: string; isError?: true }` (moved from `brief.ts`, where `BriefResult` becomes an alias or is replaced); `Io` gains `now: () => Promise<number>`.
  - `cards.ts`: `export type AskInput = Omit<TeamCard, 'id' | 'n' | 'from' | 'tag' | 'status' | 'decision' | 'reason' | 'at' | 'urgent' | 'refs'> & { urgent?: boolean; refs?: string[]; parked: boolean }`; `checkAsk(input: unknown): string | null` (the error, or null); `buildCard(input: AskInput, n: number, from: string, tag: string, at: number): TeamCard`.
  - `questions.ts`: `questionsDir(teamdir: string): string`; `readCards(io: Io, teamdir: string): Promise<TeamCard[]>` (sorted by `n`); `writeCard(io: Io, teamdir: string, card: TeamCard): Promise<void>`; `claimNumber(io: Io, teamdir: string): Promise<number | null>`; `askTool(io: Io, input: unknown): Promise<ToolResult>`; `ASK_TOOL_SPEC`.
  - `world.ts`: fields `dirs: Set<string>`, `raceMkdir: Set<string>`, `statuses: (string | undefined)[]`, `toasts: string[]`, `sendFails: string | null`; helpers `call($, tool, args)`, `card(w, n, fields)`, `envoyTeam($, on)`.

- [ ] **Step 1: Extend the test world.** In `world.ts`:
  - `process.run`: `['mkdir', '-p', p]` adds `p` to `w.dirs`, exit 0. `['mkdir', p]`: if `w.raceMkdir` has `p`, add it to `w.dirs` first (another process won). Then exit 1 with stderr `mkdir: ${p}: File exists` when `w.dirs` has `p`, else add it and exit 0.
  - `fs.list` also lists the names of `w.dirs` entries under the prefix, as `kind: 'dir'`.
  - `on('ui.status', ($, e) => { w.statuses.push(e.text); return { value: undefined } })` and `on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } })`.
  - `session.send`: when `w.sendFails` is set, return `{ isDelivered: false, reason: w.sendFails }`.
  - `ui.panes`: report the title each id was opened with, not always `Team`.
  - Helpers:

```ts
export const call = ($: any, tool: string, args: object) =>
  $.tool.call({ tool: `mcp__team__${tool}`, tool_use_id: 't1', ...args } as never)

export const CARD = {
  context: 'Fixtures load from a snapshot. The snapshot is 3 weeks old.',
  question: 'Use real fixtures or the snapshot?',
  options: [{ option: 'real fixtures', cost: '~1 h' }, { option: 'snapshot', cost: 'none' }],
  recommendation: 'real fixtures: the snapshot hides the bug',
  blocks: 'the whole task',
  door: 'two-way',
  rework: '~1 h: swap the fixture loader',
  parked: false,
}

/** Writes card Q-<n> as the mod would, with CARD's fields unless overridden. */
export function card(w: World, n: number, fields: object = {}) { /* writeJson of a full TeamCard */ }

/** A started envoy session: the config names it envoy_session; the orchestrator is another session. */
export async function envoyTeam($: any, on: On): Promise<World> { /* like team(), with envoy_session: w.id, orchestrator_session: 'sid-orch-worker' */ }
```

- [ ] **Step 2: Write the failing tests** `tests/mod/ask.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { CARD, call, team } from './world'

const asScout = async ($: any, on: any) => {
  const w = await team($, on)
  w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'fixtures', brief: '', pane: 'w1:p2', session: 'sid-scout' })
  w.id = 'sid-scout'
  return w
}

describe('ask', () => {
  test('numbers cards per run and fills from, tag and status', async ($, on) => {
    const w = await asScout($, on)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-1' })
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-2' })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({
      id: 'Q-1', n: 1, from: 'app-1-scout', tag: 'fixtures', status: 'open',
      door: 'two-way', rework: '~1 h: swap the fixture loader', urgent: false, refs: [],
    })
  })

  test('a parked card is assumed', async ($, on) => {
    const w = await asScout($, on)
    await call($, 'ask', { ...CARD, parked: true })
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('assumed')
  })

  test('a one-way card cannot be parked', async ($, on) => {
    const w = await asScout($, on)
    expect(await call($, 'ask', { ...CARD, door: 'one-way', parked: true }))
      .toMatchObject({ isError: true, result: 'a one-way card cannot be parked: wait for the answer' })
    expect(w.files.has(`${w.team}/questions/Q-1.json`)).toBe(false)
  })

  test('refuses a card without a valid door or rework', async ($, on) => {
    await asScout($, on)
    expect(await call($, 'ask', { ...CARD, door: 'maybe' }))
      .toMatchObject({ isError: true, result: 'door must be one-way or two-way' })
    expect(await call($, 'ask', { ...CARD, rework: '' }))
      .toMatchObject({ isError: true, result: 'rework is required' })
  })

  test('the orchestrator asks as itself', async ($, on) => {
    const w = await team($, on)
    await call($, 'ask', CARD)
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ from: 'app-1-orch', tag: 'general' })
  })

  test('refuses in a session that is no team agent', async ($, on) => {
    const w = await team($, on)
    w.id = 'sid-stranger'
    expect(await call($, 'ask', CARD)).toMatchObject({
      isError: true, result: 'ask works only in a team session (an agent started by team-start, or the orchestrator)',
    })
    expect([...w.files.keys()].some(p => p.includes('/questions/'))).toBe(false)
  })

  test('two asks racing for one number get distinct ids', async ($, on) => {
    const w = await asScout($, on)
    w.raceMkdir.add(`${w.team}/questions/claims/1`)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-2' })
    expect(w.files.has(`${w.team}/questions/Q-1.json`)).toBe(false)
  })

  test('numbering continues after the highest card or claim on disk', async ($, on) => {
    const w = await asScout($, on)
    w.dirs.add(`${w.team}/questions/claims/4`)
    expect(await call($, 'ask', CARD)).toMatchObject({ result: 'Q-5' })
  })
})
```

`tag: 'general'` for the orchestrator and for an empty topic follows open question 6.

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the `ask` tests FAIL (`mcp__team__ask` has no hook); every other test passes.

- [ ] **Step 4: Implement.**
  - `cards.ts`: `checkAsk` returns the first error, in this order: each of `context`, `question`, `recommendation`, `blocks`, `rework` a non-empty string (`<field> is required`); `options` a non-empty array of `{ option, cost }` strings (`options need at least one { option, cost }`); `door` (`door must be one-way or two-way`); `parked` a boolean (`parked must be true or false`); `door: 'one-way'` with `parked: true` (`a one-way card cannot be parked: wait for the answer`). `buildCard` sets `status` to `assumed` when parked, else `open`; `urgent` defaults to false, `refs` to `[]`.
  - `questions.ts`, `claimNumber`: run `mkdir -p <questions>/claims`; start at 1 + the highest `n` among `Q-<n>.json` files and `claims/<n>` names; run `mkdir <questions>/claims/<n>` and take the first `n` whose `mkdir` exits 0; give up (null) after 20 tries. `askTool`: caller identity first: the record whose `session` is this session gives `from` (its name) and `tag` (its `topic`, or `general` when empty); else, when this session is `orchestrator_session`, `from` is `config.orchestrator` and `tag` is `general`; else the refusal above. Then `checkAsk`, `claimNumber` (null -> `no free card number after 20 tries`), `writeCard`, result `Q-<n>`.
  - `ASK_TOOL_SPEC`: `name: 'ask'`; description: `File an open question for the human as a card. State door and rework; park (parked: true) only a two-way question with about an hour of rework or less, and continue on your recommendation. Returns the card id, Q-<n>; name it in your REPORT line.`; `inputSchema` with the `AskInput` fields, `required` all but `urgent` and `refs`.
  - `team.tsx`: register `ASK_TOOL_SPEC` in `session.start`; `on('tool.call', { tool: 'mcp__team__ask' }, ...)` passes the event to `askTool(makeIo($), e)`; `makeIo` adds `now: () => $.clock.now()`.

- [ ] **Step 5: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS, no other output.

- [ ] **Step 6: Validate and type-check**

Run: `claude plugin validate plugins/team`
Run: `tsc -p plugins/team`
Expected: validation passes and lists the `ask` tool; `tsc` prints nothing.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

## Build step 2: `queue`, `decide`, DECISION lines, card section

### Task 2: Envoy role resolution and the `queue` tool

**Files:**
- Modify: `plugins/team/hooks/mod/activation.ts`
- Create: `plugins/team/hooks/mod/decide.ts` (queue part)
- Modify: `plugins/team/hooks/mod/cards.ts`, `plugins/team/hooks/mod/team.tsx`
- Test: `plugins/team/tests/mod/queue.test.ts`, `plugins/team/tests/mod/activation.test.ts`

**Interfaces:**
- Consumes: `readCards`, `TeamCard` (Task 1).
- Produces:
  - `activation.ts`: `TeamConfig` gains `envoy_session?: string; envoy_tab?: string`; `roleOf(cfg: TeamConfig | null, id: string): { orchestrator: boolean; envoy: boolean }` (pure: `orchestrator` when `id === cfg.orchestrator_session`; `envoy` when `id === cfg.envoy_session`, or, without `envoy_session`, when `orchestrator`); `envoyConfig(io: Io): Promise<TeamConfig | null>`; `followClear` moves whichever of `orchestrator_session` and `envoy_session` equals the cleared id.
  - `cards.ts`: `type QueueGroup = { tag: string; count: number; cards: TeamCard[] }`; `queueGroups(cards: TeamCard[], tag?: string): QueueGroup[]`.
  - `decide.ts`: `queueTool(io: Io, input: unknown): Promise<ToolResult>` (result: `JSON.stringify({ groups })`); `QUEUE_TOOL_SPEC`; `envoyOnly(io: Io, tool: string): Promise<TeamConfig | ToolResult>`.

- [ ] **Step 1: Write the failing tests.** `tests/mod/queue.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { queueGroups } from '../../hooks/mod/cards'
import { call, card, envoyTeam, team } from './world'

const c = (n: number, tag: string, more: object = {}) =>
  ({ id: `Q-${n}`, n, tag, door: 'two-way', status: 'open', urgent: false, ...more }) as any

describe('queueGroups', () => {
  test('groups by tag; urgent, one-way, open before assumed, oldest first', () => {
    const groups = queueGroups([
      c(1, 'a'), c(2, 'a', { door: 'one-way' }), c(3, 'a', { urgent: true, status: 'assumed' }),
      c(4, 'a', { status: 'answered' }), c(5, 'b'), c(6, 'b', { status: 'assumed' }), c(7, 'b'),
    ])
    expect(groups.map(g => [g.tag, g.count, g.cards.map(x => x.id)])).toEqual([
      ['a', 3, ['Q-3', 'Q-2', 'Q-1']],
      ['b', 3, ['Q-5', 'Q-7', 'Q-6']],
    ])
  })

  test('a tag filter keeps one group', () => {
    expect(queueGroups([c(1, 'a'), c(2, 'b')], 'b').map(g => g.tag)).toEqual(['b'])
  })
})

describe('queue tool', () => {
  test('returns the groups in the envoy session', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 1, { tag: 'fixtures' })
    const r = await call($, 'queue', {})
    expect(JSON.parse(r.result).groups[0]).toMatchObject({ tag: 'fixtures', count: 1 })
  })

  test('refuses in a session that is not the envoy', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    expect(await call($, 'queue', {})).toMatchObject({ isError: true, result: 'queue works only in the envoy session' })
  })

  test('without envoy_session the orchestrator session holds the envoy tools', async ($, on) => {
    const w = await team($, on)
    card(w, 1)
    expect((await call($, 'queue', {})).isError).toBeUndefined()
  })
})
```

Group order: each group sorts by its first card under the same order, so a group with an urgent card comes first.

Add to `tests/mod/activation.test.ts`:

```ts
  test('follows the envoy session through its own /clear', async ($, on) => {
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
      orchestrator_session: 'sid-orch-worker', envoy_session: 'sid-orch',
    })
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-envoy-2'
    await w.clock.advance(15000)
    expect(w.json(`${w.team}/config.json`)).toMatchObject({
      envoy_session: 'sid-envoy-2', orchestrator_session: 'sid-orch-worker',
    })
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the new tests FAIL; every other test passes.

- [ ] **Step 3: Implement** `roleOf`, `envoyConfig`, the `followClear` change, `queueGroups`, `queueTool` and `envoyOnly` (refusal text: `<tool> works only in the envoy session`). Register `QUEUE_TOOL_SPEC` (`name: 'queue'`, optional `tag` string; description: `List the open and assumed cards grouped by tag, most pressing first. Envoy session only.`) and its `tool.call` hook in `team.tsx`. The per-tick role switch is Task 9; this task only adds the functions and the tool.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.** Show Chebu the diff.

---

### Task 3: The `decide` tool

**Files:**
- Modify: `plugins/team/hooks/mod/decide.ts`, `plugins/team/hooks/mod/team.tsx`
- Modify: `plugins/team/skills/team-orchestration/templates/decisions.md`
- Test: `plugins/team/tests/mod/decide.test.ts`

**Interfaces:**
- Consumes: `envoyOnly` (Task 2), `readCards`, `writeCard` (Task 1).
- Produces:
  - `decide.ts`: `nextDecision(text: string): number` (pure: 1 + the highest `n` of lines matching `^(\d+)[a-z]?\.\s`, or 1); `decisionParagraph(n: number, date: string, answer: string, rationale: string, ids: string[]): string`; `type DecisionEntry = { n: number; cards: { id: string; from: string; tag: string }[]; answer: string; rationale: string; overrides: string[]; at: number }`; `decideTool(io: Io, input: unknown): Promise<ToolResult>`; `DECIDE_TOOL_SPEC`.
  - Ledger file `.team/decisions/<n>.json` holds one `DecisionEntry`. Task 4 reads it.

- [ ] **Step 1: Write the failing tests** `tests/mod/decide.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { nextDecision } from '../../hooks/mod/decide'
import { call, card, envoyTeam, team } from './world'

const HEAD = '# Decisions APP-1\nNumbered, dated, one paragraph each. Amendments: 3a replaces 3, 5a amends 5.\nEvery brief reads this file first. Mirror to every active worktree after each append.\n'
const file = (w: any) => `${w.cwd}/scratchpad/current/decisions-APP-1.md`
const ANSWER = { answer: 'Use real fixtures.', rationale: 'The snapshot hides the bug.' }

describe('nextDecision', () => {
  test('counts amendments under their number', () => {
    expect(nextDecision(`${HEAD}\n1. (d) a\n2. (d) b\n2a. (d) c\n`)).toBe(3)
  })
  test('a header-only file starts at 1', () => {
    expect(nextDecision(HEAD)).toBe(1)
  })
})

describe('decide', () => {
  test('closes two cards with one decision', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), `${HEAD}\n1. (2026-10-07) first.\n2. (2026-10-07) second.\n`)
    card(w, 1, { from: 'app-1-scout', tag: 'fixtures' })
    card(w, 2, { from: 'app-1-tester', tag: 'fixtures' })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-2'], ...ANSWER })).toMatchObject({ result: 'Decision 3' })
    expect(w.files.get(file(w))!.text.endsWith(
      '3. (1970-01-01) Use real fixtures. Why: The snapshot hides the bug. Cards: Q-1, Q-2.\n')).toBe(true)
    for (const id of ['Q-1', 'Q-2']) {
      expect(w.json(`${w.team}/questions/${id}.json`)).toMatchObject({ status: 'answered', decision: 3 })
    }
    expect(w.json(`${w.team}/decisions/3.json`)).toMatchObject({
      n: 3, overrides: [], answer: 'Use real fixtures.',
      cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'fixtures' }, { id: 'Q-2', from: 'app-1-tester', tag: 'fixtures' }],
    })
  })

  test('records which assumptions the decision overrides', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1, { status: 'assumed' })
    await call($, 'decide', { cards: ['Q-1'], overrides: ['Q-1'], ...ANSWER })
    expect(w.json(`${w.team}/decisions/1.json`).overrides).toEqual(['Q-1'])
  })

  test('one bad card writes nothing at all', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    card(w, 2, { status: 'answered', decision: 1 })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-2'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'Q-2 is already answered (decision 1)' })
    expect(await call($, 'decide', { cards: ['Q-1', 'Q-9'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'no card Q-9' })
    expect(await call($, 'decide', { cards: ['Q-1'], overrides: ['Q-1'], ...ANSWER }))
      .toMatchObject({ isError: true, result: 'Q-1 is not an assumed card of this decision' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('marks cards obsolete without a decision', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], obsolete: true, reason: 'superseded by Q-2' }))
      .toMatchObject({ result: 'Obsolete: Q-1' })
    expect(w.json(`${w.team}/questions/Q-1.json`)).toMatchObject({ status: 'obsolete', reason: 'superseded by Q-2' })
    expect(w.files.get(file(w))!.text).toBe(HEAD)
  })

  test('refuses outside the envoy session and writes nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    for (const id of ['sid-orch-worker', 'sid-scout']) {
      w.id = id
      expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER }))
        .toMatchObject({ isError: true, result: 'decide works only in the envoy session' })
    }
    expect(w.files.get(file(w))!.text).toBe(HEAD)
    expect(w.json(`${w.team}/questions/Q-1.json`).status).toBe('open')
  })

  test('without envoy_session the orchestrator session decides', async ($, on) => {
    const w = await team($, on)
    w.write(file(w), HEAD)
    card(w, 1)
    expect(await call($, 'decide', { cards: ['Q-1'], ...ANSWER })).toMatchObject({ result: 'Decision 1' })
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the `decide` tests FAIL.

- [ ] **Step 3: Implement `decideTool`.** Order: `envoyOnly`; input check (`cards` a non-empty array of `Q-<n>` strings; either `answer` and `rationale` non-empty, or `obsolete: true` with a non-empty `reason`); read every named card and check each is `open` or `assumed` (`no card Q-<n>`, `Q-<n> is already <status> (decision <d>)`, or `Q-<n> is already obsolete`); check every `overrides` id is in `cards` with status `assumed`. Only then write: the paragraph appended to `<run dir>/decisions-<ticket>.md` (missing file -> `no decisions file: <path>`, checked before any write), the ledger entry, then the cards. The date is `new Date(await io.now()).toISOString().slice(0, 10)`. The paragraph is `<n>. (<date>) <answer> Why: <rationale> Cards: <ids joined by ", ">.` plus `\n`, after a `\n` when the file does not end with one. Register `DECIDE_TOOL_SPEC` (`name: 'decide'`; description: `Close cards with one numbered decision, or mark them obsolete. List in overrides the assumed cards whose assumption this answer changes. Envoy session only. Returns "Decision <n>".`) and its hook.

- [ ] **Step 4: Drop the placeholder from the template.** In `templates/decisions.md`, delete the line `1. (YYYY-MM-DD) ...`, so the first `decide` gives decision 1.

- [ ] **Step 5: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 4: DECISION lines to the orchestrator

**Files:**
- Create: `plugins/team/hooks/mod/decisions.ts`
- Modify: `plugins/team/hooks/mod/tick.ts`, `plugins/team/hooks/mod/team.tsx`
- Test: `plugins/team/tests/mod/decisions.test.ts`

**Interfaces:**
- Consumes: `DecisionEntry` and the ledger (Task 3); `newReportLines` (today in `tick.ts`).
- Produces:
  - `decisions.ts`: `decisionLine(e: DecisionEntry): string`; `pickDecisions(entries: DecisionEntry[], mark: number | undefined): { lines: string[]; mark: number }` (a missing mark is 0: the ledger only holds entries `decide` wrote, so there is no old backlog to hold back).
  - `tick.ts`: `newReportLines` returns `{ lines, delivered, commit }`, and `commit(extra: Record<string, number>)` writes `delivered` merged with `extra` in one write. `readLedger(io: Io, teamdir: string): Promise<DecisionEntry[]>`.

- [ ] **Step 1: Write the failing tests** `tests/mod/decisions.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { decisionLine, pickDecisions } from '../../hooks/mod/decisions'
import { start, team } from './world'

const entry = (n: number, more: object = {}) => ({
  n, answer: 'Use real fixtures.', rationale: 'r', overrides: [], at: 0,
  cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'fixtures' }, { id: 'Q-2', from: 'app-1-tester', tag: 'fixtures' }],
  ...more,
})

describe('decisionLine', () => {
  test('names every card with its agent and tag', () => {
    expect(decisionLine(entry(3)))
      .toBe('DECISION 3 (Q-1 app-1-scout/fixtures, Q-2 app-1-tester/fixtures): Use real fixtures.')
  })
  test('says which assumption it overrides', () => {
    expect(decisionLine(entry(3, { overrides: ['Q-1'] })))
      .toBe('DECISION 3 (Q-1 app-1-scout/fixtures, Q-2 app-1-tester/fixtures): Use real fixtures. - overrides assumption Q-1')
  })
})

describe('pickDecisions', () => {
  test('sends entries above the mark, in number order', () => {
    expect(pickDecisions([entry(5), entry(4), entry(3)], 3).lines.map(l => l.slice(0, 10)))
      .toEqual(['DECISION 4', 'DECISION 5'])
  })
  test('no mark yet sends every entry', () => {
    expect(pickDecisions([entry(1)], undefined)).toMatchObject({ mark: 1 })
  })
})

describe('DECISION delivery in the tick', () => {
  test('is sent once, after REPORT lines and before WATCH lines', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, { 'app-1-scout': 0 })
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0]).toContain('DECISION 1 (')
    expect(w.json(`${w.team}/delivered.json`)).toMatchObject({ 'app-1-scout': 0, _decision: 1 })
  })

  test('exactly once across the orchestrator /clear', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(15000)
    await $.session.end({ reason: 'clear', sessionId: 'sid-orch', resume: { id: '' } } as never)
    w.id = 'sid-after-clear'
    await start($)
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
    w.writeJson(`${w.team}/decisions/2.json`, entry(2))
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 2 '))).toHaveLength(1)
  })

  test('a decision whose submit failed is sent on the next tick', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.submitFails = true
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** `decisionLine`: `DECISION <n> (<id> <from>/<tag>, ...): <answer>`, plus ` - overrides assumption <ids joined by ", ">` when `overrides` is not empty. In the tick (`team.tsx`), after `newReportLines`: `readLedger`, `pickDecisions(entries, reports.delivered._decision)`, send `[...reports.lines, ...decisions.lines, ...watch]` as one `$.prompt.submit`, then `reports.commit({ _decision: decisions.mark })`, only when the submit did not throw (today's pattern).

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS, including the existing `reports.test.ts`.

- [ ] **Step 5: Checkpoint.** Show Chebu the diff.

---

### Task 5: Card section in the `Team` pane

**Files:**
- Modify: `plugins/team/types/index.d.ts`, `plugins/team/hooks/mod/pane.tsx`, `plugins/team/hooks/mod/team.tsx`
- Test: `plugins/team/tests/mod/pane.test.ts`

**Interfaces:**
- Consumes: `readCards`, `queueGroups` (Tasks 1, 2).
- Produces: state `team.cards: TeamCard[]` (every card of the run, read each tick in the half that draws the panes); `PaneView` gains `cards: TeamCard[]`.

- [ ] **Step 1: Write the failing tests** in `tests/mod/pane.test.ts`:

```ts
  test('shows the open queue by tag with urgent cards on top', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { tag: 'fixtures' })
    card(w, 2, { tag: 'fixtures', status: 'assumed' })
    card(w, 3, { tag: 'auth', urgent: true, from: 'app-1-tester', question: 'Approve rm -rf build?' })
    card(w, 4, { tag: 'auth', status: 'answered', decision: 1 })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'team-overview', props: { bodyColumns: 80 } } as never)
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
    const at = (re: RegExp) => texts.findIndex((t: string) => re.test(t))
    expect(at(/^Questions \(2 open, 1 assumed\)$/)).toBeGreaterThan(-1)
    expect(at(/! Q-3 app-1-tester: Approve rm -rf build\?/)).toBeLessThan(at(/fixtures +1 open +1 assumed/))
    expect(at(/auth +1 open/)).toBeGreaterThan(-1)
  })
```

- [ ] **Step 2: Run to see it fail**

Run: `claude plugin test plugins/team`
Expected: FAIL.

- [ ] **Step 3: Implement.** Below the plan and above `Agents`: a bold `Questions (<open> open, <assumed> assumed)` line (counts over `open` and `assumed` cards); then one row per urgent unresolved card, `! <id> <from>: <question>`, `!` in yellow, `truncate-end`; then one row per `queueGroups` group, `<tag>  <n> open  <m> assumed` (a zero count left out). With no unresolved card the section is one dim `Questions: none open`. The tick reads cards into `team.cards`; Task 9 moves that read into the envoy half.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.** Show Chebu the diff.

---

## Build step 3: the envoy

### Task 6: Orchestrator role in `team-start`, agent files, envoy role skill

**Files:**
- Modify: `plugins/team/bin/team-start`
- Create: `plugins/team/agents/team-orchestrator.md`, `plugins/team/agents/team-envoy.md`, `plugins/team/skills/team-role-envoy/SKILL.md`
- Test: `plugins/team/tests/test_team.py` (class `TeamStart`; new class `AgentFiles`)

**Interfaces:**
- Produces: `team-start <name> orchestrator ...` starts `--agent team-orchestrator` with defaults `opus-5-5`, effort `medium`, mode `auto` (open question 2). The record's `role` is `orchestrator`; Task 9 reads it.

- [ ] **Step 1: Write the failing tests.** In `class TeamStart`:

```python
    def test_orchestrator_role_starts_the_orchestrator_agent(self):
        p = self.run_script("team-start", "orch", "orchestrator", "--pane", "w1:p2",
                            "--cwd", self.proj, env_extra=self.bar_env("Opus 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assert_started(self.start_argv("orch", "team-orchestrator", "claude-opus-5-5", "medium"))
        self.assertEqual(self.team_json("orch")["role"], "orchestrator")
```

New class:

```python
class AgentFiles(unittest.TestCase):
    def frontmatter(self, name):
        text = read_text(os.path.join(ROOT, "agents", name + ".md"))
        return text.split("---")[1]

    def test_every_role_has_an_agent_file(self):
        for role in ("investigator", "implementer", "tester", "orchestrator", "envoy"):
            with self.subTest(role=role):
                self.assertIn("name: team-%s" % role, self.frontmatter("team-" + role))

    def test_envoy_preloads_its_role_skill(self):
        fm = self.frontmatter("team-envoy")
        self.assertIn("- team-role-envoy", fm)
        self.assertTrue(os.path.exists(os.path.join(ROOT, "skills", "team-role-envoy", "SKILL.md")))
```

- [ ] **Step 2: Run to see them fail**

Run: `python3 plugins/team/tests/test_team.py TeamStart.test_orchestrator_role_starts_the_orchestrator_agent AgentFiles`
Expected: FAIL (`unknown role: orchestrator`; missing agent files).

- [ ] **Step 3: Implement.**
  - `team-start`: add `orchestrator) def_effort=medium; def_model=opus-5-5 ;;` to the role `case`, and `orchestrator` to the usage text where roles are listed (none today; leave the usage as is if it lists none).
  - `agents/team-orchestrator.md`: frontmatter `name: team-orchestrator`, description `Runs a team: briefs agents, reads reports, asks the human through cards. Started by team-init in a worker tab.`, `model: claude-opus-5-5`, `skills: [team-orchestration]` as a YAML list. Body: `You are the orchestrator of the team run in .team/config.json. Your rules are in the preloaded skill. You never talk to the human in chat: anything you need from the human becomes a card via the ask tool. Act on RELAY, REPORT, DECISION and WATCH lines as they arrive.`
  - `agents/team-envoy.md`: `name: team-envoy`, description `Talks to the human for a team run: presents the question queue on a pull, records decisions, relays requests to the orchestrator.`, `model: claude-opus-5-5`, `disallowedTools: Edit, MultiEdit, NotebookEdit, Write`, skills `team-orchestration`, `team-role-envoy`. Body: `You are the envoy of a team run. Your rules are in the preloaded skills. Speak only when the human speaks to you.`
  - `skills/team-role-envoy/SKILL.md`: frontmatter `name: team-role-envoy`, description `Envoy role for the team workflow: pull-driven, talks to the human, single writer of the decisions file.`. Body: the five standing rules of the design's "Envoy role" section, verbatim, plus: `Record every decision with decide, never by editing the decisions file. Pass in overrides every assumed card whose assumption the answer changes.` and `The status line and toasts flag urgent cards; when the human asks about them, call queue and present the urgent cards first.`

- [ ] **Step 4: Run the whole bash suite**

Run: `python3 plugins/team/tests/test_team.py`
Expected: `OK`.

- [ ] **Step 5: Validate**

Run: `claude plugin validate plugins/team`
Expected: validation passes and lists the two agents and the skill.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 7: `team-init` makes this session the envoy and starts the orchestrator

**Files:**
- Modify: `plugins/team/bin/team-init`
- Modify: `plugins/team/commands/init.md`
- Test: `plugins/team/tests/test_team.py` (class `TeamInit`)

**Interfaces:**
- Consumes: `team-start <team_id>-orch orchestrator --new-tab --label orch` (Task 6).
- Produces: `config.json` = `{ team_id, ticket, orchestrator, envoy_session, envoy_tab?, orchestrator_session, orchestrator_tab }`. `--orchestrator-pane` is gone; `--envoy-pane <id>` records `envoy_tab` and adds the tab to `tabs.json`. Exit 4 with `orchestrator did not start: <team-start stderr>` when `team-start` fails; the config then holds no `orchestrator_session`.

- [ ] **Step 1: Give every `TeamInit` test a status bar the orchestrator start accepts.** In `class TeamInit`, add:

```python
    def run_script(self, name, *args, scenario="ok", env_extra=None, cwd=None):
        env = {**self.bar_env("Opus 5.5", cwd=self.proj), **(env_extra or {})}
        return super().run_script(name, *args, scenario=scenario, env_extra=env, cwd=cwd)
```

`bar_env` lives in `TeamStart` today; move it to `Base`.

- [ ] **Step 2: Write the failing tests** in `class TeamInit`:

```python
    def cfg(self):
        return json.loads(read_text(self.sp(".team", "config.json")))

    def test_records_this_session_as_envoy(self):
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.cfg()["envoy_session"], "orch-sid")

    def test_starts_the_orchestrator_in_a_worker_tab(self):
        p = self.run_script("team-init", "APP-1")
        self.assertEqual(p.returncode, 0, p.stderr)
        calls = self.herdr_calls()
        self.assertTrue(any(c.startswith("tab create") and "--label orch" in c for c in calls), calls)
        self.assertTrue(any("agent start app-1-orch " in c and "--agent team-orchestrator" in c for c in calls), calls)
        self.assertEqual(self.cfg()["orchestrator_session"], self.team_json("app-1-orch")["session"])
        self.assertTrue(self.cfg()["orchestrator_tab"])

    def test_envoy_pane_records_the_envoy_tab(self):
        p = self.run_script("team-init", "APP-1", "--envoy-pane", "w1:p1", scenario="pane_in_tab")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.cfg()["envoy_tab"], "w1:t1")
        self.assertIn("w1:t1", json.loads(read_text(self.sp(".team", "tabs.json"))))

    def test_failed_orchestrator_start_is_a_herdr_error(self):
        p = self.run_script("team-init", "APP-1", env_extra=self.bar_env("Sonnet 5.5", cwd=self.proj))
        self.assertEqual(p.returncode, 4, p.stderr)
        self.assertIn("orchestrator did not start", p.stderr)
        self.assertNotIn("orchestrator_session", self.cfg())
        self.assertEqual(self.cfg()["envoy_session"], "orch-sid")

    def test_orchestrator_pane_flag_is_gone(self):
        p = self.run_script("team-init", "APP-1", "--orchestrator-pane", "w1:p1")
        self.assertEqual(p.returncode, 2)
```

Replace `--orchestrator-pane` with `--envoy-pane` in `test_records_orchestrator_tab`, `test_config_names_the_orchestrator_tab`, `test_does_not_rename_the_orchestrator` and `test_missing_orchestrator_pane_value_is_bad_args`; rename the first two to `test_records_envoy_tab` and `test_config_names_the_envoy_tab` and assert `envoy_tab`. In `test_records_orchestrator_session`, assert `orchestrator_session` equals the `app-1-orch` record's `session`. If `pane_in_tab` answers `pane get` with `w1:t1` for every pane, `orchestrator_tab` is also `w1:t1` there; that is fine.

- [ ] **Step 3: Run to see them fail**

Run: `python3 plugins/team/tests/test_team.py TeamInit`
Expected: the new tests FAIL.

- [ ] **Step 4: Implement in `bin/team-init`.**
  - Usage: `usage: team-init <ticket> [--envoy-pane <id>]`; parse `--envoy-pane` into `envoy_pane`; `--orchestrator-pane` falls to `unknown argument`.
  - Config write: `envoy_session` from `TEAM_SESSION_ID`; no `orchestrator_session` yet.
  - The tab block records `envoy_tab` (not `orchestrator_tab`) from `--envoy-pane`, and adds the tab to `tabs.json` as today.
  - After the allowlist seed, start the orchestrator: `"$here/team-start" orch orchestrator --new-tab --label orch --cwd "$PWD"`. Capture its stderr. On a non-zero exit, print `orchestrator did not start: <stderr>` and exit 4.
  - Read `"$teamdir/${team_id}-orch.json"`: write its `session` to the config as `orchestrator_session`, and the tab of its `pane` (`herdr pane get`, as the tab block does today) as `orchestrator_tab`.
  - The index prune stays last.

- [ ] **Step 5: Rewrite `commands/init.md`.** Keep its front matter; change the `description` to `Start a team run for a ticket in this session: this session becomes the envoy, the orchestrator starts in a worker tab.` The steps:
  1. Load the `team-orchestration` and `team-role-envoy` skills.
  2. Run `team-init <ticket> --envoy-pane <this pane id>`. Its stderr on a non-zero exit goes to the human; then stop.
  3. and 4. The decisions and plan files, as today.
  5. `team-status` for the first roster.
  6. Tell the human, in two sentences, that the team is up and that the `Team` and `Questions` tabs show it (`/team-overview` when the pane is too narrow). Ask what the orchestrator should start with, and send the answer with `relay`.

- [ ] **Step 6: Version floor (only on Chebu's answer to open question 1).** If Chebu raises it: set `min_version="2.1.292"` in `team-init`, and change `test_refuses_old_claude_code` to `FAKE_CLAUDE_VERSION: "2.1.291"` and `Claude Code 2.1.291 is older than 2.1.292`, and the `fake-claude` default to `2.1.292`.

- [ ] **Step 7: Run the whole bash suite**

Run: `python3 plugins/team/tests/test_team.py`
Expected: `OK`.

- [ ] **Step 8: Checkpoint.** Show Chebu the diff.

---

### Task 8: The `relay` tool

**Files:**
- Create: `plugins/team/hooks/mod/relay.ts`
- Modify: `plugins/team/hooks/mod/team.tsx`
- Test: `plugins/team/tests/mod/relay.test.ts`

**Interfaces:**
- Consumes: `envoyOnly` (Task 2), `io.sendTo`.
- Produces: `relayTool(io: Io, input: unknown): Promise<ToolResult>`; `RELAY_TOOL_SPEC`. Sends `RELAY <message>` to `orchestrator_session`; result `sent`.

- [ ] **Step 1: Write the failing tests** `tests/mod/relay.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { call, envoyTeam, team } from './world'

describe('relay', () => {
  test('sends the message to the orchestrator session', async ($, on) => {
    const w = await envoyTeam($, on)
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject({ result: 'sent' })
    expect(w.sends).toEqual([{ to: { sessionId: 'sid-orch-worker' }, text: 'RELAY stop the tester' }])
  })

  test('refuses outside the envoy session and sends nothing', async ($, on) => {
    const w = await envoyTeam($, on)
    for (const id of ['sid-orch-worker', 'sid-scout']) {
      w.id = id
      expect(await call($, 'relay', { message: 'x' }))
        .toMatchObject({ isError: true, result: 'relay works only in the envoy session' })
    }
    expect(w.sends).toEqual([])
  })

  test('refuses where the orchestrator session is also the envoy', async ($, on) => {
    const w = await team($, on)
    expect(await call($, 'relay', { message: 'x' })).toMatchObject({
      isError: true, result: 'relay needs a separate envoy session; this session runs the orchestrator',
    })
    expect(w.sends).toEqual([])
  })

  test('an undelivered message is an error with the reason', async ($, on) => {
    const w = await envoyTeam($, on)
    w.sendFails = 'session not found'
    expect(await call($, 'relay', { message: 'x' }))
      .toMatchObject({ isError: true, result: 'not delivered: session not found' })
  })

  test('an empty message is refused', async ($, on) => {
    await envoyTeam($, on)
    expect(await call($, 'relay', { message: ' ' })).toMatchObject({ isError: true, result: 'message is required' })
  })
})
```

Check the `to` shape against `brief.test.ts`, which expects `to: 'sid-scout'` from `io.sendTo`; match whatever `w.sends` records for `brief_send` today.

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the `relay` tests FAIL.

- [ ] **Step 3: Implement** `relayTool` over `envoyOnly` and `io.sendTo(cfg.orchestrator_session, 'RELAY ' + message.trim())`. Register `RELAY_TOOL_SPEC` (`name: 'relay'`, required string `message`; description: `Pass an operational request from the human to the orchestrator. Envoy session only. Returns "sent".`) and its hook.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 5: Checkpoint.** Show Chebu the diff.

---

### Task 9: Per-role activation: the tick splits into two halves

**Files:**
- Modify: `plugins/team/hooks/mod/team.tsx`, `plugins/team/hooks/mod/tick.ts`
- Test: `plugins/team/tests/mod/roles.test.ts`

**Interfaces:**
- Consumes: `roleOf` (Task 2); the record role `orchestrator` (Task 6); `envoy_tab` (Task 7).
- Produces:
  - `tick.ts`: `syncPanes(io, teamdir, records, listed): Promise<void>` (the pane write-back now in `agentRows`); `agentRows` becomes read-only; `readRecords` keeps the orchestrator record; `watchTick` and `reportFiles` skip records with `role === 'orchestrator'`; `watchTick` takes `exemptTabs: string[]` instead of `orchestratorTab?: string`.
  - `team.tsx`: `tick` resolves `roleOf(cfg, myId)`; the orchestrator half runs `syncPanes`, `watchTick` (exempt: `orchestrator_tab`, `envoy_tab`), reports, decisions and the submit; the envoy half runs the plan, `agentRows`, `cards` and opens the pane on first activation. `active` is true when either role holds.

- [ ] **Step 1: Write the failing tests** `tests/mod/roles.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { roleOf } from '../../hooks/mod/activation'
import { envoyTeam, team } from './world'

const report = (line: string) => `# Report\n\n---\n\n${line}\n`

describe('roleOf', () => {
  const cfg = { team_id: 'a', ticket: 'A', orchestrator: 'a-orch', orchestrator_session: 'o', envoy_session: 'e' }
  test('names each half', () => {
    expect(roleOf(cfg, 'o')).toEqual({ orchestrator: true, envoy: false })
    expect(roleOf(cfg, 'e')).toEqual({ orchestrator: false, envoy: true })
    expect(roleOf(cfg, 'x')).toEqual({ orchestrator: false, envoy: false })
  })
  test('without envoy_session the orchestrator holds both', () => {
    expect(roleOf({ ...cfg, envoy_session: undefined }, 'o')).toEqual({ orchestrator: true, envoy: true })
  })
})

describe('the two halves', () => {
  test('the envoy session draws and never submits', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team-overview'])
    expect(w.submits).toEqual([])
  })

  test('the orchestrator session submits and never draws', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual([])
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
  })

  test('a team dir without envoy_session runs both halves in the orchestrator', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, report('REPORT app-1-scout x: done'))
    await w.clock.advance(15000)
    expect(w.opened).toEqual(['team-overview'])
    expect(w.submits).toEqual(['REPORT app-1-scout x: done'])
  })

  test('the orchestrator record is neither watched nor reported', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    w.writeJson(`${w.team}/app-1-orch.json`, { role: 'orchestrator', topic: '', brief: 'b', pane: 'w1:p9', session: 'sid-orch-worker' })
    w.agents = [{ pane_id: 'w1:p9', tab_id: 'w1:t9', agent_status: 'idle', agent_session: { value: 'sid-orch-worker' } }]
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-orch-.md`, report('REPORT app-1-orch x: y'))
    await w.clock.advance(15000)
    await w.clock.advance(150000)
    expect(w.submits.join('\n')).not.toContain('app-1-orch')
  })

  test('the envoy tab is exempt from layout hygiene', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    const cfg = w.json(`${w.team}/config.json`)
    w.writeJson(`${w.team}/config.json`, { ...cfg, envoy_tab: 'w1:t5' })
    w.writeJson(`${w.team}/tabs.json`, ['w1:t5'])
    w.writeJson(`${w.team}/app-1-gone.json`, { role: 'tester', topic: '', brief: '', pane: 'w1:p50', session: 'sid-gone' })
    w.panes = [{ pane_id: 'w1:p50', tab_id: 'w1:t5', agent_status: 'none' }]
    await w.clock.advance(15000)
    expect(w.runs.some(r => r.includes('close') && r.includes('w1:p50'))).toBe(false)
  })

  test('brief_send stays with the orchestrator session', async ($, on) => {
    await envoyTeam($, on)
    expect(await $.tool.call({ tool: 'mcp__team__brief_send', tool_use_id: 't1', name: 'app-1-scout', topic: 'dig' } as never))
      .toMatchObject({ isError: true })
  })
})
```

`envoyTeam` writes the scout record with `topic: ''`, as `team` does, so its report file is `reports/app-1-scout-.md`.

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: the half tests FAIL; `roleOf` passes (Task 2).

- [ ] **Step 3: Implement** the split as in the Interfaces block. The `/team-overview` command and the `ui.close` hook take the config from `envoyConfig`, not `activeConfig`. `followClear` runs once per tick, before `roleOf`.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS, including every earlier mod test (they use `team()`, which has no `envoy_session`).

- [ ] **Step 5: Checkpoint.** Show Chebu the diff.

---

### Task 10: Two panes, `team` and `questions`

**Files:**
- Modify: `plugins/team/hooks/mod/pane.tsx`, `plugins/team/hooks/mod/team.tsx`
- Modify: `plugins/team/tests/mod/pane.test.ts`, `plugins/team/tests/mod/world.ts` (`agentRows` helper), `plugins/team/tests/mod/roles.test.ts`
- Test: `plugins/team/tests/mod/pane.test.ts`

**Interfaces:**
- Produces: `pane.tsx`: `TEAM_PANE = 'team'`, `QUESTIONS_PANE = 'questions'` (replacing `PANE`); `drawQuestions(elements, cards: TeamCard[])`; `team.tsx`: `showPanes($, teamId)` opens `team` then `questions` (the last opened is shown, so the order matters little; both titles as in Global Constraints).

- [ ] **Step 1: Rename the pane id in the tests.** Replace every `'team-overview'` pane id in `pane.test.ts`, `roles.test.ts` and the `agentRows` helper in `world.ts` with `'team'`. Change `expect(w.opened).toEqual(['team-overview'])` to `toEqual(['team', 'questions'])`.

- [ ] **Step 2: Write the failing tests** in `pane.test.ts`:

```ts
  test('/team-overview hides and shows both tabs', async ($, on) => {
    const w = await activeTeam($, on)
    await $.command.run({ command: 'team-overview' } as never)
    expect(w.closed.sort()).toEqual(['questions', 'team'])
    await $.command.run({ command: 'team-overview' } as never)
    expect(w.opened).toEqual(['team', 'questions', 'team', 'questions'])
  })

  test('closing either tab by hand counts as hiding', async ($, on) => {
    const w = await activeTeam($, on)
    await $.ui.close({ id: 'questions', origin: { kind: 'person' } } as never)
    expect(w.store.get('overviewHidden:app-1')).toBe(true)
  })

  test('the question log lists every card, newest first, with how it closed', async ($, on) => {
    const w = await activeTeam($, on)
    card(w, 1, { status: 'answered', decision: 3, door: 'one-way', from: 'app-1-scout', tag: 'fixtures' })
    card(w, 2, { from: 'app-1-tester', tag: 'auth' })
    await w.clock.advance(15000)
    const ui = await $.ui.mount({ plugin: 'team', surface: 'terminal', component: 'Pane',
                                  requestId: 'questions', props: { bodyColumns: 100 } } as never)
    const rows = (await ui.findAll({ type: 'Text', text: /^Q-\d/ })).map((t: any) => t.text.replace(/\s+/g, ' '))
    expect(rows[0]).toMatch(/^Q-2 open two-way app-1-tester\/auth: /)
    expect(rows[1]).toMatch(/^Q-1 answered #3 one-way app-1-scout\/fixtures: /)
  })
```

Check `$.ui.close`'s test input shape in the types (`'ui.close'` input) before you rely on `origin`; adjust the call, not the expectation.

- [ ] **Step 3: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL.

- [ ] **Step 4: Implement.** One `ui.render` hook per pane id. `drawQuestions` rows: `<id> <status>[ #<decision>] <door> <from>/<tag>: <question>`, `truncate-end`, newest first; an empty log is one dim `no questions yet`. `/team-overview`: when either pane is open, close both and store hidden; else store shown and open both. The `ui.close` hook matches both ids; a close by the person stores hidden.

- [ ] **Step 5: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 11: Urgent badge and toast

**Files:**
- Create: `plugins/team/hooks/mod/badge.ts`
- Modify: `plugins/team/hooks/mod/team.tsx`, `plugins/team/hooks/mod/tick.ts` (`NON_RECORD` gains `toasted.json`), `plugins/team/types/index.d.ts` (state `urgent: number`)
- Test: `plugins/team/tests/mod/badge.test.ts`

**Interfaces:**
- Consumes: `team.cards` (Task 5), the envoy half (Task 9).
- Produces: `badge.ts`: `badgeText(cards: TeamCard[]): string | undefined`; `freshUrgent(cards: TeamCard[], seen: string[] | null): { toast: TeamCard[]; seen: string[] }` (a missing `toasted.json` is a baseline: mark, toast nothing); `toastText(c: TeamCard): string`.

- [ ] **Step 1: Write the failing tests** `tests/mod/badge.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { badgeText, freshUrgent } from '../../hooks/mod/badge'
import { card, envoyTeam } from './world'

const c = (n: number, more: object = {}) =>
  ({ id: `Q-${n}`, n, from: 'app-1-tester', question: 'Approve rm -rf build?', status: 'open', urgent: true, ...more }) as any

describe('badgeText', () => {
  test('counts unresolved urgent cards and names the oldest', () => {
    expect(badgeText([c(4), c(3, { status: 'assumed' }), c(2, { status: 'answered' }), c(1, { urgent: false })]))
      .toBe('2 urgent: Q-3 app-1-tester: Approve rm -rf build?')
  })
  test('no urgent card clears the badge', () => {
    expect(badgeText([c(1, { urgent: false })])).toBeUndefined()
  })
})

describe('freshUrgent', () => {
  test('no marks yet is a baseline', () => {
    expect(freshUrgent([c(1)], null)).toEqual({ toast: [], seen: ['Q-1'] })
  })
  test('toasts a card once', () => {
    expect(freshUrgent([c(1), c(2)], ['Q-1']).toast.map(x => x.id)).toEqual(['Q-2'])
  })
})

describe('in the envoy session', () => {
  test('sets the status line, toasts each new urgent card once, starts no turn', async ($, on) => {
    const w = await envoyTeam($, on)
    w.writeJson(`${w.team}/toasted.json`, [])
    card(w, 3, { urgent: true, from: 'app-1-tester', question: 'Approve rm -rf build?' })
    await w.clock.advance(15000)
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBe('1 urgent: Q-3 app-1-tester: Approve rm -rf build?')
    expect(w.toasts).toEqual(['URGENT Q-3 app-1-tester: Approve rm -rf build?'])
    expect(w.submits).toEqual([])
  })

  test('clears the status line when the last urgent card closes', async ($, on) => {
    const w = await envoyTeam($, on)
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    card(w, 3, { urgent: true, status: 'answered', decision: 1 })
    await w.clock.advance(15000)
    expect(w.statuses.at(-1)).toBeUndefined()
  })

  test('the orchestrator session sets no badge', async ($, on) => {
    const w = await envoyTeam($, on)
    w.id = 'sid-orch-worker'
    card(w, 3, { urgent: true })
    await w.clock.advance(15000)
    expect(w.statuses).toEqual([])
    expect(w.toasts).toEqual([])
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `claude plugin test plugins/team`
Expected: FAIL.

- [ ] **Step 3: Implement.** `badgeText`: unresolved = `open` or `assumed`; `<count> urgent: <oldest id> <from>: <question>`. `toastText`: `URGENT <id> <from>: <question>`. In the envoy half: compute the badge; call `$.ui.status(text)` only when it differs from the last value this module set (a module variable, initially a value no badge can take, so the first tick always sets it); then `freshUrgent` against `.team/toasted.json`, one `$.ui.toast(toastText(c))` per fresh card (default timeout), then write the marks. Store the count in `team.urgent`.

- [ ] **Step 4: Run the tests**

Run: `claude plugin test plugins/team`
Expected: all PASS.

- [ ] **Step 5: Validate and type-check**

Run: `claude plugin validate plugins/team`
Run: `tsc -p plugins/team`
Expected: validation passes; `tsc` prints nothing.

- [ ] **Step 6: Live check with Chebu (manual, ~10 min).** In a throwaway repo: `/team:init PROBE-1` in Chebu's session. Confirm: the orchestrator starts in a new tab; the `Team` and `Questions` tabs show in the envoy session; a worker `ask` with `urgent: true` shows the status line and one toast, and no envoy turn starts; `decide` closes it, the badge clears, and the orchestrator gets one `DECISION` line. Write the result to `scratchpad/current/live-check-envoy.md`.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff and the live check file.

---

## Protocol and spec

### Task 12: Protocol skill rule changes

**Files:**
- Modify: `plugins/team/skills/team-orchestration/SKILL.md`
- Modify: `plugins/team/skills/team-role-investigator/SKILL.md`, `team-role-implementer/SKILL.md`, `team-role-tester/SKILL.md`
- Modify: `plugins/team/skills/team-orchestration/templates/brief.md`

**Interfaces:**
- Consumes: the tool names and line formats of Tasks 1-11.

- [ ] **Step 1: Change the intro paragraph** of `SKILL.md` to: `You run or take part in a team workflow. The human talks to one envoy session. The orchestrator runs the team from a worker tab and never talks to the human. Role agents run in Herdr panes. Briefs are files. Decisions are numbered. Open questions are cards. Reports arrive as files through a Stop hook; the team mod delivers them to the orchestrator. These twenty-one rules bind everyone.`

- [ ] **Step 2: Change the rules** (rule numbers stay; rule 6 is replaced, rule 21 is new):
  - Rule 1, first sentence: `The orchestrator plans, briefs, reads reports, and decides with the human through cards and the envoy, never in chat.` In its last paragraph, replace `talk to the human;` with `file cards with ask; act on RELAY lines;`.
  - Rule 2: `The human decides, through the envoy. A card recommends one option with one sentence of reasoning.`
  - Rule 4, add: `The envoy is its single writer, through the decide tool; nobody edits it by hand.`
  - Rule 5, add after the format: `A REPORT names the cards its agent filed: REPORT tester fixtures: 2 questions open (Q-12, Q-13).` Replace `delivers the line within 15 s` with `delivers the line to the orchestrator within 15 s`.
  - Rule 6, replaced: `Reports reach the human only as cards. The envoy presents one group of cards at a time, chosen by the human or proposed by the envoy. A DECISION line tells the orchestrator what was decided; it relays the answer to the waiting worker and schedules any rework an overridden assumption causes.`
  - Rule 7: `Every mention of an agent in a card carries name (pane, session).` Drop the roster sentence.
  - Rule 9, second sentence: `Unknowns become cards via ask, never guesses.`
  - Rule 14: replace `The team mod runs in your own session.` with `The team mod runs in the orchestrator's session and in the envoy's.`
  - Rule 15, first clause: `Pane budgets: the human's tab is the envoy's (the Team and Questions tabs are panes inside the envoy session, not herdr panes); the orchestrator runs alone in its own worker tab;`. Replace `in your own workspace` with `in the caller's workspace`.
  - Rule 16, replaced: `The orchestrator never speaks to the human. The envoy speaks only when the human pulls; urgent cards show as a status line and a toast in the envoy session, never as a turn.`
  - Rule 17: replace `whenever you ask the human to act (a - [ ] you: <action> item, marked [x] when the human confirms)` with `whenever a card asks the human to act`.
  - New rule 21: `Every card states door (one-way or two-way) and rework (a concrete estimate). Park a two-way card with about an hour of rework or less: file it with parked: true, record the assumption in your work, and continue. Wait on every other card; its blocks field names what waits.`

- [ ] **Step 3: Role skills.** In each of the three role skills, after the line about `SendMessage`, add: `A question only the human can answer becomes a card via ask (rule 21); name its id in your REPORT.` In `team-role-investigator`, change `Every unknown becomes a numbered open question.` to `Every unknown becomes a numbered open question in the document, and one that blocks you also becomes a card.`

- [ ] **Step 4: Brief template.** In `templates/brief.md`, change the REPORT line to `REPORT {{name}} {{topic}}: <at most ten lines: verdict, files written, counts, blockers, card ids>` and the rule `Source-backed facts only; unknowns become numbered open questions.` to `Source-backed facts only; unknowns become numbered open questions, and a blocking one becomes a card via ask.`

- [ ] **Step 5: Scan for em dashes and run both suites**

Run: `grep -rn "—" plugins/team/skills`
Expected: no output.
Run: `python3 plugins/team/tests/test_team.py`
Run: `claude plugin test plugins/team`
Expected: both green (the brief compose tests read `templates/brief.md`; fix an assertion only if it quotes the old REPORT line).

- [ ] **Step 6: Checkpoint.** Show Chebu the diff.

---

### Task 13: SPEC.md increment, README, version

**Files:**
- Modify: `plugins/team/SPEC.md`, `plugins/team/README.md`, `plugins/team/.claude-plugin/plugin.json`, and every other file the last version bump touched.

- [ ] **Step 1: Mirror the protocol.** Replace the rules under `## Protocol (content of skills/team-orchestration/SKILL.md)` with the 21 rules of Task 12, verbatim.

- [ ] **Step 2: Update the reference sections.**
  - `## Repo layout`: add `agents/team-orchestrator.md`, `agents/team-envoy.md`, `skills/team-role-envoy/SKILL.md`, and `cards.ts, questions.ts, decide.ts, decisions.ts, relay.ts, badge.ts` under `hooks/mod/`.
  - `## Roles`: rows for `orchestrator` (`team-orchestrator`, Opus 5.5, medium, auto, started by `team-init`) and `envoy` (`team-envoy`; the human's own session after `/team:init`, or a fresh session started with that agent).
  - `### Task-scope files`: rows for `.team/questions/Q-<n>.json` (the `ask` tool; one card), `.team/questions/claims/<n>` (the `ask` tool; id claims), `.team/decisions/<n>.json` (the `decide` tool; the ledger the orchestrator tick reads), `.team/toasted.json` (the envoy tick; toast marks); `decisions-<ticket>.md` is now written by the `decide` tool.
  - `### Commands`: `/team:init` runs in the session the human talks to, which becomes the envoy; `team-init --envoy-pane`; `/team-overview` hides or shows both tabs.
  - `### The team mod`: activation per role (`roleOf`; a config without `envoy_session` runs both halves in the orchestrator session); the two halves of the tick; the panes `team` and `questions`; the urgent badge and toast; the tools `ask`, `queue`, `decide`, `relay` with their refusals and line formats (`DECISION`, `RELAY`); the `_decision` mark.

- [ ] **Step 3: Add the increment** at the end of SPEC.md:

```markdown
## Increment 2026-10-07

Design: `docs/superpowers/specs/2026-10-07-team-envoy-and-question-queue-design.md`.
Plan: `docs/superpowers/plans/2026-10-07-team-envoy-and-question-queue.md`.

Open questions are cards in `.team/questions/`, filed by any team session
with the `ask` tool and closed by the `decide` tool, which numbers the
decision, appends it to the decisions file and keeps a ledger. The human's
session becomes the envoy: `team-init` records it as `envoy_session` and
starts the orchestrator as a worker in its own tab. The mod runs per role:
the orchestrator half sends REPORT, DECISION and WATCH lines; the envoy half
draws the `Team` and `Questions` tabs, keeps an urgent badge in the status
line, toasts each new urgent card, and serves `queue`, `decide` and `relay`.
A team dir without `envoy_session` runs both halves in the orchestrator
session.
```

- [ ] **Step 4: README.** Update the quick start where it describes `/team:init` and the `Team` pane, so it says the human's session becomes the envoy and the orchestrator starts in a worker tab.

- [ ] **Step 5: Version.** Find the files the last bump touched:

Run: `git show --stat 0c7cbf5`
Bump the version in each of those files to `0.6.0`.

- [ ] **Step 6: Final checks**

Run: `grep -rn "—" plugins/team`
Expected: no output.
Run: `claude plugin validate plugins/team`
Run: `tsc -p plugins/team`
Run: `python3 plugins/team/tests/test_team.py`
Run: `claude plugin test plugins/team`
Expected: all green, no other output.

- [ ] **Step 7: Checkpoint.** Show Chebu the diff.

---

## Open questions

1. **Minimum Claude Code version.** The probe verified tabs, `$.ui.status` and `$.ui.toast` on 2.1.292 (`findings-mod-ui-probe.md`, header). `team-init` checks 2.1.287 (`plugins/team/bin/team-init:42`). Options: (A) raise to 2.1.292: only the probed build runs; users on 2.1.287-2.1.291 must update. (B) keep 2.1.287: no forced update, but the panes and badge are untested there. Recommend A: the envoy panes depend on probed behavior, and an older build fails in ways no test catches. Task 7 Step 6 applies it.
2. **How the orchestrator starts.** The design says `team-init` starts it "with `team-start` in a worker tab", but `team-start` knows only `investigator`, `implementer` and `tester` (`plugins/team/bin/team-start:19-24`), and no orchestrator agent file exists (`plugins/team/agents/`). Options: (A) a new role `orchestrator` with `agents/team-orchestrator.md` (preloads `team-orchestration`), defaults opus-5-5 / medium / auto, its record skipped by watch and report pickup; (B) start it as `investigator` with a different brief: wrong tool limits (no Edit) and wrong role skill. Recommend A: one agent file per role is the existing pattern. Tasks 6, 7 and 9 follow A.
3. **How the human's running session becomes the envoy.** Decision 9 makes the current session the envoy, but the design also names a `team-envoy` agent, and a running session cannot change its agent. Options: (A) `/team:init` loads the `team-role-envoy` skill into the current session; `agents/team-envoy.md` serves a fresh envoy (`claude --agent team-envoy`); (B) `/team:init` starts a new envoy session in a pane: contradicts decision 9. Recommend A. Not planned: a fresh envoy session has no way to claim `envoy_session` in a live run (a restart without `--resume` loses it). Recommend a later mod command `/team-envoy` that records the current session as `envoy_session`; one small task, outside this plan until Chebu agrees.
4. **Line and file formats the design does not fix.** Plan choices: a DECISION over several cards is `DECISION <n> (Q-1 <from>/<tag>, Q-2 <from>/<tag>): <answer>`, plus ` - overrides assumption <ids>`; relayed text is `RELAY <message>`; a decision paragraph is `<n>. (<date>) <answer> Why: <rationale> Cards: <ids>.`. Options: accept, or name other formats. Recommend accept: the REPORT/WATCH family is one keyword then content, and the paragraph matches the file's "numbered, dated, one paragraph" header.
5. **Who judges "overrides assumption".** The design has the DECISION line say it when a decision differs from an assumed recommendation, but `decide` takes free text, so the mod cannot compare. Options: (A) the envoy lists the overridden cards in an `overrides` input, which the mod checks against `assumed` cards; (B) the mod flags every decision that closes an `assumed` card: wrong when the answer confirms the assumption. Recommend A: the judgment stays with the agent (design decision 8). Tasks 3 and 4 follow A.
6. **The tag of a card with no brief topic.** The tag is "the agent's current brief topic" (design, Card), but the orchestrator has no topic, and a worker started without a brief has `topic: ""` (`team-start` record). Options: (A) `general`; (B) the agent's name: splits one subject across agents. Recommend A. Task 1 follows A.
7. **Keep the both-halves fallback for good?** Build step 2 lets the human use `queue` and `decide` from the orchestrator session "during the transition". The plan keeps it: a config without `envoy_session` runs both halves in the orchestrator session. Options: (A) keep it permanently: old team dirs and a failed orchestrator start stay usable; (B) remove it after Task 9: one mode, but an upgrade mid-run loses the pane. Recommend A: it is the upgrade path (Review Focus 1) and costs one branch in `roleOf`.
8. **Obsolete cards and a waiting worker.** `decide` with `obsolete: true` writes no decision, so no line reaches the orchestrator, and a worker that waits on the card stays blocked. Options: (A) nothing: the envoy marks a card obsolete only when another decision covers it, and that DECISION line reaches the orchestrator; (B) an `OBSOLETE Q-<n> (<from>/<tag>): <reason>` line. Recommend A for now: it needs no new line, and the envoy role skill can state the rule. Revisit if a worker is seen waiting on an obsolete card.
9. **Mirroring the decisions file into worktrees.** The decisions header says "Mirror to every active worktree after each append" (`templates/decisions.md:3`); today `team-brief prepare` mirrors it at brief time (`tests/test_team.py:783`). `decide` appends between briefs. Options: (A) leave it to `team-brief prepare` and the DECISION line, which the orchestrator relays to the worker; (B) `decide` also copies the file into every worktree run dir. Recommend A: the worker learns the answer from the relay, and the next brief mirrors the file.
