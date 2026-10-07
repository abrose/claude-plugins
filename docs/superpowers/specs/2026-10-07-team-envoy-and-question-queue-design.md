# Design: team plugin - question queue and envoy

Date: 2026-10-07
Status: approved; probe done (2026-10-07)
Relates to: `plugins/team/SPEC.md`. This is an increment on that spec.

## Problem

1. With several workers in parallel, questions reach the human through the
   orchestrator's chat. A new REPORT or WATCH line starts a new orchestrator
   turn while the human still reads an open question, and the question
   scrolls away. Protocol rule 6 ("reports are discussed one at a time")
   is prose only; the mod's `$.prompt.submit` breaks it.
2. When the human is away, several questions arrive and later scroll out of
   view. The orchestrator then re-asks "Q1-QN" without context, and the human
   rebuilds the context from scratch.
3. The orchestrator chat mixes the machine clock (react to every report,
   brief the next agent) with the human clock (answer in large blocks, when
   ready). The machine clock wins, so the chat is noisy.

Goal: fewer, larger attention blocks per task. Fewer context switches.

## Decisions (this brainstorm)

1. Open questions are durable state, not chat. Each one is a self-contained
   card in a queue. A card stays open until a decision closes it.
2. The worker writes the card, not the orchestrator. The worker knows the
   context best, and a card written at the source needs no second summary.
3. The human talks to an envoy, not to the orchestrator. The orchestrator
   stays push-driven and runs the team. The envoy is pull-driven and talks
   to the human. Nothing pushes turns into the envoy.
4. One exception to pull: urgent cards (a blocked agent, an approval for a
   destructive action, a failed gate) show as a badge or toast in the envoy
   session. They never start an envoy turn.
5. The envoy is the single writer of the decisions file. It writes through a
   mod tool, so its chat shows one dim line per decision (chebu-ui quiet
   tools), not file edits.
6. Grouping has two layers. The mod groups cards by tag, deterministically.
   The envoy adds judgment grouping at pull time (cards that reframe each
   other, cards made obsolete by a decision).
7. No secretary agent. Grouping needs the envoy's context (what the human
   focuses on now), and tag grouping in the mod covers the background case.
   Revisit only if queue work crowds the envoy's context.
8. Rule for all mechanics: anything mechanical goes into the mod (numbering,
   tagging, closing cards, grouping by tag). Agents keep only judgment.
9. The human's current session becomes the envoy. `team-init` runs there,
   records it as `envoy_session`, and starts the orchestrator as a worker in a
   worker tab.
10. Operational requests travel through a `relay` tool, envoy to
    orchestrator. The human never needs the orchestrator pane.
11. The `Team` pane moves to the envoy session and gets a second tab: the
    question log.
12. Each card carries a severity: one-way or two-way door, plus the rework a
    different answer would cause. Severity decides whether the worker waits
    or parks the question and continues.
13. Card ids are numbered per team run (`Q-<n>`), separate from the decision
    numbers.

## Components

### Card

One open question, readable cold hours later. Fields:

- `id`: `Q-<n>`, numbered by the mod, unique per team run.
- `from`: the agent name.
- `tag`: the agent's current brief topic, taken from its record by the mod.
  The worker never types it.
- `context`: 2-3 lines. What the agent found and why the question came up.
- `question`: one sentence.
- `options`: each with its cost.
- `recommendation`: the agent's pick and why.
- `blocks`: what waits on the answer (nothing, part of the task, the whole
  task).
- `door`: `one-way` (hard or expensive to undo: a public API, a data
  migration, a deleted thing) or `two-way` (cheap to change later).
- `rework`: what a different answer would cost after the fact, as a concrete
  estimate ("~1 h: swap the fixture loader", "a day: redo the schema and
  backfill").
- `urgent`: true only for the cases in decision 4.
- `refs`: paths to report, brief, or delivered files.
- `status`: `open`, `assumed`, `answered`, or `obsolete`; `decision`: the
  number that closed it.

### Severity: wait or park

The worker proposes `door` and `rework`; the envoy shows both, so the human
can correct a wrong call.

- `two-way` with small rework (about an hour or less): the worker parks the
  card. It assumes its recommendation, records the assumption in its work,
  and continues. The card status is `assumed`.
- `one-way`, or large rework: the worker waits. The card status is `open`
  and `blocks` names what waits.

When a decision differs from an `assumed` recommendation, the DECISION line
says so (`overrides assumption`), and the orchestrator schedules the rework.

Storage: one JSON file per card in `.team/questions/Q-<n>.json`. A
subdirectory, because every top-level `*.json` in `.team/` is read as an
agent record.

### Tool `ask` (`mcp__team__ask`)

Any team session can call it: workers and the orchestrator. Takes the card
fields above minus `id`, `from`, `tag`, `status`, plus `parked: true|false`
per the severity rule. The mod fills those, writes
the card, and returns `Q-<n>`. The worker's REPORT names its cards:
`REPORT tester fixtures: 2 questions open (Q-12, Q-13)`.

The orchestrator uses `ask` too. Anything it needs from the human becomes a
card, including "this report needs your review" with the report in `refs`.
The orchestrator no longer talks to the human in chat.

### Tool `decide` (`mcp__team__decide`)

Envoy session only, like `brief_send` is orchestrator-only. Takes
`{ cards: [Q-<n>...], answer, rationale }`. One call can close several cards
with one decision. The mod:

1. gives the next decision number,
2. appends the decision to the numbered decisions file, with the card ids,
3. marks the cards `answered` with that number,
4. returns `Decision <n>`.

A `{ cards, obsolete: true, reason }` form marks cards obsolete without a
decision.

### Tool `queue` (`mcp__team__queue`)

Envoy session only. Returns the open and assumed cards grouped by tag.
Order inside a group: urgent, then one-way, then open before assumed, then
oldest first. Optional `tag` filter for "show me everything on the auth
slice". The envoy calls it when the human pulls.

### Orchestrator side

The orchestrator mod tick picks up new decisions (marks in
`.team/delivered.json`, like reports) and submits them as
`DECISION <n> (Q-12 tester/fixtures): <answer>` lines, next to REPORT and
WATCH lines. The orchestrator relays the answer to the blocked worker.

### Envoy role

A new role skill `team-role-envoy`, preloaded into a new agent
`team-envoy`. Standing rules:

- Speak plain prose. No file paths, ids, or tool names unless the human
  asks.
- On a pull, call `queue`, then present one group at a time. Propose
  judgment groupings ("these 3 are all about auth, take them together?").
- Present a card with its full context. Never a bare "Q-12".
- After a decision, confirm in one sentence: "Decision 14: we use real
  fixtures. The tester is unblocked."
- Relay operational requests from the human ("stop the tester") to the
  orchestrator with `relay`.

### Tool `relay` (`mcp__team__relay`)

Envoy session only. Takes `{ message }` and sends it to
`orchestrator_session` with `$.session.send`, the same path `brief_send`
uses toward workers. Returns `sent`. The orchestrator acts on it like a
human message. If it needs a choice from the human, it answers with a card
via `ask`, never in a reply to the envoy.

### Start: the human's session becomes the envoy

`team-init` runs in the human's current session. It records that session
as `envoy_session` in `.team/config.json`, then starts the orchestrator
with `team-start` in a worker tab and records it as `orchestrator_session`.
The mod activates per role: the orchestrator tick (reports, watch rules,
DECISION lines, layout hygiene) in `orchestrator_session`; the panes, the
urgent badge, and the envoy-only tools in `envoy_session`. Layout hygiene
exempts the envoy's tab, as it exempts `orchestrator_tab` today.

### Envoy panes

The envoy session opens two panes, which the engine draws as tabs in one
frame (probe: `scratchpad/current/findings-mod-ui-probe.md`, section a):

1. Pane `team`, title `Team`: plan (DONE, RUNNING, NEXT), agents, and the
   open queue grouped by tag with counts. Urgent cards on top.
2. Pane `questions`, title `Questions`: the question log. Every card of the
   run, newest first, with status, door, and the decision that closed it.
   This is the place to look up "why did we decide that".

The person switches tabs. The mod cannot pick the shown tab, and an urgent
card never switches it: the badge and the toast point the human to it, and
the human pulls.

Urgent badge: `$.ui.status` text, for example `2 urgent: Q-12 ...`, kept
current by the tick and cleared when no urgent card is open. The engine
draws it as plain text in its own warning color. Each new urgent card also
gets one `$.ui.toast`. Neither starts a model turn.

In a herdr pane narrower than 144 columns, an unasked open waits undrawn.
The existing `/team-overview` toggle is the way in, as for the `Team` pane
today.

## Protocol changes

- Rule 1: the orchestrator decides with the human through cards and the
  envoy, not in chat.
- Rule 4: the envoy is the single writer of the decisions file, via
  `decide`.
- Rule 6: replaced. Reports reach the human only as cards. One group at a
  time, chosen by the human or proposed by the envoy.
- Rule 9: "Unknowns become numbered open questions" now means cards via
  `ask`.
- Rule 15: the human's tab is the envoy's; the orchestrator runs in a worker
  tab.
- Rule 16: the orchestrator speaks to the human never; the envoy speaks only
  when pulled, plus the urgent badge.
- New rule: every card states `door` and `rework`. Park two-way, small-rework
  questions; wait on the rest.

## Build order

1. Cards and `ask`, with the REPORT line naming its cards. ~half a day.
2. `queue`, `decide`, DECISION lines to the orchestrator, card section in a
   pane. ~half a day. Useful without the envoy: the human can call these
   from the orchestrator session during the transition.
3. The envoy: role skill and agent, `team-init` start path, `relay`, the
   panes moved to the envoy session with the `Questions` tab, the urgent
   badge. ~1 day, plus ~1 h for the mod UI tabs probe.

## Open questions

None.

## Testing

Mod tests in `plugins/team/tests/mod/` with the existing fakes: `ask` numbers
and tags cards, and stores `door` and `rework`; `decide` numbers decisions,
closes several cards, flags `overrides assumption`, refuses outside the envoy
session; `queue` groups and sorts; `relay` refuses outside the envoy session
and sends to `orchestrator_session`; the orchestrator tick delivers each
DECISION once; the mod activates the right half per role. Bash tests for
`team-init` recording `envoy_session` and starting the orchestrator as a
worker.

## Out of scope

- A secretary agent (decision 7).
- Cross-team queues.
