import type { TeamCard, TeamPlan } from '../../types'
import { queueGroups } from './cards'
import { normalizeDialog, samePrompt } from './herdr'

const MINUTE_MS = 60_000

export type NextActionAgent = {
  name: string
  role: string
  pane: string
  topic: string
  /** The herdr state: working, idle, blocked, done, gone or ?. */
  state: string
  /** The record names a brief. Only a briefed agent shows under "Running now". */
  briefed: boolean
  /** The mtime of the brief file in ms, or null when there is none. */
  briefedAt: number | null
  /** The dialog text of a blocked agent; '' when unknown. */
  dialog: string
}

/** A record that files cards but never shows as a running agent: the orchestrator. */
export type NextActionFiler = { name: string; role: string; pane: string }

export type NextActionInput = {
  cards: TeamCard[]
  plan: TeamPlan | null
  agents: NextActionAgent[]
  /** Names a card's filer by role and pane, like `agents`, without a place under "Running now". */
  filers: NextActionFiler[]
  orchestratorGone: boolean
  /** The whole team waits on the human: `stallIds` is not null. */
  stalled: boolean
  /** The last auto-mode denial of each agent: `.team/denials/<name>.json`. */
  denials: { name: string; tool: string; at: number }[]
  now: number
}

/** A burst of changes waits at most this long for a quiet tick (decision 2). */
export const BURST_CAP_MS = 60_000

/** Every message the mod submits starts with this; the envoy skill and the tests tell it from the human. */
export const NEXT_ACTION_PREFIX = 'NEXT-ACTION from the team mod'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const openCards = (cards: TeamCard[]) => cards.filter(c => c.status === 'open')

const roleAndPane = (a: { role: string; pane: string }) => `the ${a.role} (${a.pane})`

const isFinished = (plan: TeamPlan | null) =>
  !!plan && plan.waits.length === 0 && plan.running.length === 0 && plan.next.length === 0 && plan.done.length > 0

function filedBy(card: TeamCard, input: NextActionInput): string {
  const who = [...input.agents, ...input.filers].find(a => a.name === card.from)
  return who ? `from ${roleAndPane(who)}` : `from ${card.from}`
}

const CARD_ID = /\bQ-\d+\b/g

/**
 * The `[?]` plan steps that wait on their own. Rule 17 marks a `[?]` step for each open card, so a step that
 * names an open card's id is that card and counts once, as the card. Any other `[?]` step (a manual test, a go)
 * is a thing that waits on the human: it stays in the block while a card is open or a worker is blocked.
 */
function ownWaits(plan: TeamPlan | null, open: TeamCard[]): string[] {
  const ids = new Set(open.map(c => c.id))
  return (plan?.waits ?? [])
    .filter(step => !(step.text.match(CARD_ID) ?? []).some(id => ids.has(id)))
    .map(step => step.text)
}

function runningNow(input: NextActionInput): string {
  const working = input.agents.filter(a => a.briefed && a.state === 'working')
  if (working.length > 0) {
    return working.map(a => {
      const on = a.topic ? ` on ${a.topic}` : ''
      const minutes = a.briefedAt === null ? '' : `, ${Math.floor((input.now - a.briefedAt) / MINUTE_MS)} min`
      return `${roleAndPane(a)}${on}${minutes}`
    }).join('; ')
  }
  const planned = (input.plan?.running ?? []).map(i => i.text)
  return planned.length > 0 ? planned.join('; ') : 'nothing'
}

/** The block: the mod's statement of the facts. The envoy tells the human these four lines in its own words. */
export function nextActionBlock(input: NextActionInput): string {
  const open = queueGroups(openCards(input.cards)).flatMap(g => g.cards)
  // While its prompt shows, an open card about a worker's prompt and that blocked worker are one thing that waits.
  // A card linked to an earlier prompt (the hold window of a closing card) does not cover a worker that now shows
  // another one: that worker is its own thing.
  const covered = (a: NextActionAgent) =>
    open.some(c => c.prompt?.agent === a.name && samePrompt(c.prompt.dialog, a.dialog))
  const blocked = input.agents.filter(a => a.state === 'blocked' && !covered(a))
  const own = ownWaits(input.plan, open)
  const things = open.length + blocked.length + own.length
  const plan = input.plan
  const running = input.agents.some(a => a.state === 'working') || (plan?.running.length ?? 0) > 0

  const state = input.orchestratorGone
    ? 'Orchestrator gone: run /team-envoy to start a new one.'
    : things > 0
      ? `Blocked on you: ${things} ${plural(things, 'thing waits', 'things wait')}.`
      : isFinished(plan)
        ? 'Finished: every step is done.'
        : running
          ? 'Running: nothing waits on you.'
          : 'Waiting on the team: all agents idle, no card open.'

  const promptLine = (a: NextActionAgent) =>
    `Allow or deny a permission prompt in the ${a.role}'s pane (${a.pane})${a.dialog ? `: ${a.dialog}` : ''}`
  const then = (text: string, more: string) => `${text}${/[.?!]$/.test(text) ? ' ' : '. '}${more}`
  const moreCards = (cards: TeamCard[]) =>
    cards.length > 0 ? `${cards.length} more: ${cards.map(c => c.id).join(', ')}. Ask me to show them.` : ''

  let next = 'nothing - the team works on its own'
  let alsoInPlan = own
  const lead = open[0]
  const stuck = blocked[0]
  // The lead card is about an earlier prompt of a worker that now shows another one (the hold window of a closing
  // card): the worker leads, and the cards of its earlier prompts are named as closing by themselves.
  const newPrompt = lead?.prompt ? blocked.find(a => a.name === lead.prompt!.agent) : undefined
  if (newPrompt) {
    const closing = open.filter(c => c.prompt?.agent === newPrompt.name)
    const verdict = plural(
      closing.length, 'is about an earlier prompt in that pane and closes by itself',
      'are about earlier prompts in that pane and close by themselves')
    next = then(promptLine(newPrompt), `${closing.map(c => c.id).join(', ')} ${verdict}`)
    const rest = open.filter(c => !closing.includes(c))
    if (rest.length > 0) next = then(next, moreCards(rest))
  } else if (lead) {
    next = `Answer: ${lead.question} (${lead.id}, ${filedBy(lead, input)})`
    if (open.length > 1) next = then(next, moreCards(open.slice(1)))
  } else if (stuck) {
    next = promptLine(stuck)
  } else if (own[0]) {
    next = own[0]
    alsoInPlan = own.slice(1)
  }
  if (alsoInPlan.length > 0) next = then(next, `Also waits in the plan: ${alsoInPlan.join('; ')}`)

  const after = (plan?.next ?? []).slice(0, 2).map(i => i.text)
  return [
    state,
    `Next for you: ${next}`,
    `Running now: ${runningNow(input)}`,
    `After that: ${after.length > 0 ? after.join('; ') : 'nothing planned'}`,
  ].join('\n')
}

/** The block without its volatile field, the minutes spent. */
export const nextActionKey = (block: string) => block.replace(/, \d+ min\b/g, '')

/** What the run looked like at one tick: the ids and texts the triggers and the change list compare. */
export type NextActionSnapshot = {
  /** Ids of the open cards (parked ones are `parked`). */
  open: string[]
  /** The open cards that are urgent. */
  urgent: string[]
  parked: string[]
  waits: string[]
  done: string[]
  working: string[]
  /**
   * Each blocked agent with the dialog it shows (whitespace collapsed). A new dialog on a worker that stays
   * blocked is a new prompt, so the trigger T5 fires on it; an empty dialog (a failed read) matches any.
   */
  blocked: { name: string; dialog: string }[]
  /** One mark per agent's last denial: `<name>@<ms>`. */
  denials: string[]
  /** Ids of the cards the team mod closed. A card the mod closed is no trigger, but the change list names it once. */
  closed: string[]
  stalled: boolean
  gone: boolean
  finished: boolean
}

export function nextActionSnapshot(input: NextActionInput): NextActionSnapshot {
  const open = openCards(input.cards)
  const named = (state: string) => input.agents.filter(a => a.state === state).map(a => a.name)
  return {
    open: open.map(c => c.id),
    urgent: open.filter(c => c.urgent).map(c => c.id),
    parked: input.cards.filter(c => c.status === 'assumed').map(c => c.id),
    waits: (input.plan?.waits ?? []).map(i => i.text),
    done: (input.plan?.done ?? []).map(i => i.text),
    working: named('working'),
    blocked: input.agents
      .filter(a => a.state === 'blocked')
      .map(a => ({ name: a.name, dialog: normalizeDialog(a.dialog) })),
    denials: input.denials.map(d => `${d.name}@${d.at}`),
    closed: input.cards.filter(c => c.status === 'obsolete' && c.closed_by === 'team mod').map(c => c.id),
    stalled: input.stalled,
    gone: input.orchestratorGone,
    finished: isFinished(input.plan),
  }
}

/** The snapshot fields the triggers T1 to T8 read, as one string. They join the key (see `nextActionView`). */
const triggerMarks = (s: NextActionSnapshot) =>
  JSON.stringify([s.open, s.waits, s.done, s.blocked, s.denials, s.stalled, s.gone, s.finished])

/**
 * The block, the snapshot and the key of one tick. The key is the block minus its minutes, then every snapshot
 * field a trigger reads. So a fired trigger always changes the key, also when the block text stays the same: a
 * step done while an agent still works, a second [?] item while a card is open, a stall, a denial. Without that,
 * the rule "no message for the same key" would hide the trigger, and a later change with no trigger of its own
 * (a card closes) would carry it out late.
 */
export function nextActionView(input: NextActionInput): { block: string; snapshot: NextActionSnapshot; key: string } {
  const block = nextActionBlock(input)
  const snapshot = nextActionSnapshot(input)
  return { block, snapshot, key: `${nextActionKey(block)}\n${triggerMarks(snapshot)}` }
}

/**
 * A blocked worker of `target` with an empty dialog (a failed read) takes the non-empty dialog `source` holds for
 * the same name; a dialog that was read is never replaced. Without it, a snapshot stored on a failed read holds an
 * empty dialog, which matches any prompt, and a later new prompt in the same worker would fire no trigger.
 * Two uses: the tick's snapshot takes the dialog of the last sent one (a failed read on this tick), and the last
 * sent one takes the dialog read now (a failed read on the tick that sent).
 */
export const carryDialogs = (target: NextActionSnapshot, source: NextActionSnapshot): NextActionSnapshot => ({
  ...target,
  blocked: target.blocked.map(t => {
    if (t.dialog) return t
    const read = source.blocked.find(s => s.name === t.name && s.dialog)
    return read ? { name: t.name, dialog: read.dialog } : t
  }),
})

const fresh = (now: string[], before: string[]) => now.filter(x => !before.includes(x))

/** The blocked agents that are new, or show a different prompt than at the last send. */
const freshBlocked = (now: NextActionSnapshot['blocked'], before: NextActionSnapshot['blocked']) =>
  now.filter(n => !before.some(b => b.name === n.name && samePrompt(b.dialog, n.dialog)))

/** The changes between the snapshot at the last send and now, in plain words with the id after the meaning. */
export function changeList(before: NextActionSnapshot, input: NextActionInput): string[] {
  const now = nextActionSnapshot(input)
  const byId = new Map(input.cards.map(c => [c.id, c]))
  const agentNamed = (name: string) => input.agents.find(a => a.name === name)
  const out: string[] = []
  for (const id of fresh(now.open, before.open)) {
    const c = byId.get(id)!
    const urgent = c.urgent ? ', urgent' : ''
    out.push(`New card: ${c.question} (${c.id}${urgent}, ${filedBy(c, input)})`)
  }
  for (const id of fresh(now.parked, before.parked).filter(i => !before.open.includes(i))) {
    const c = byId.get(id)!
    out.push(`Parked card filed: ${c.question} (${c.id})`)
  }
  for (const id of [...before.open, ...before.parked]) {
    const c = byId.get(id)
    if (c?.status === 'answered') {
      const decision = c.decision === undefined ? '' : `decision ${c.decision}, `
      out.push(`Card answered: ${c.question} (${decision}${c.id})`)
    } else if (c?.status === 'obsolete' && c.closed_by !== 'team mod') {
      out.push(`Card closed as obsolete: ${c.question} (${c.id})`)
    }
  }
  // Every card the mod closed since the last send, also one the last snapshot never held (it opened and closed
  // between two messages). The decision 11 line: the next message lists a self-closed card as closed.
  for (const id of fresh(now.closed, before.closed)) {
    const c = byId.get(id)!
    out.push(`Card closed by the team mod, the prompt is gone: ${c.question} (${c.id})`)
  }
  for (const text of fresh(now.waits, before.waits)) out.push(`Step waits on you: ${text}`)
  for (const text of fresh(now.done, before.done)) out.push(`Step done: ${text}`)
  for (const mark of freshBlocked(now.blocked, before.blocked)) {
    const a = agentNamed(mark.name)
    if (!a) continue
    const shown = before.blocked.some(b => b.name === mark.name)
    const dialog = mark.dialog ? `: ${mark.dialog}` : ''
    out.push(shown
      ? `The ${a.role} (${a.pane}) shows a new permission prompt${dialog}`
      : `The ${a.role} (${a.pane}) is blocked on a permission prompt`)
  }
  for (const d of input.denials.filter(x => !before.denials.includes(`${x.name}@${x.at}`))) {
    const a = agentNamed(d.name)
    out.push(`Auto mode denied ${a ? roleAndPane(a) : d.name} a tool call: ${d.tool}`)
  }
  for (const name of fresh(now.working, before.working)) {
    const a = agentNamed(name)
    if (a) out.push(`Agent started: ${roleAndPane(a)}${a.topic ? ` on ${a.topic}` : ''}`)
  }
  if (now.stalled && !before.stalled) out.push('Every agent waits on you')
  if (now.gone && !before.gone) out.push('The orchestrator is gone')
  if (now.finished && !before.finished) out.push('The run is finished')
  return out
}

/** The marks `.team/next-action.json` keeps: the last key sent or shown, the snapshot then, and the open burst. */
export type NextActionMarks = {
  key: string
  snapshot: NextActionSnapshot
  pending: { firstAt: number; key: string; held: number } | null
}

/** The triggers that fired between the snapshot at the last send and now (design 2.2, T1 to T8). */
export function triggersOf(before: NextActionSnapshot, now: NextActionSnapshot): { fired: string[]; urgent: boolean } {
  const newOpen = fresh(now.open, before.open)
  const triggers: [string, boolean, boolean][] = [
    ['T1', newOpen.length > 0, newOpen.some(id => now.urgent.includes(id))],
    ['T2', fresh(now.waits, before.waits).length > 0, false],
    ['T3', fresh(now.done, before.done).length > 0, false],
    ['T4', now.stalled && !before.stalled, false],
    ['T5', freshBlocked(now.blocked, before.blocked).length > 0, true],
    ['T6', fresh(now.denials, before.denials).length > 0, true],
    ['T7', now.gone && !before.gone, true],
    ['T8', now.finished && !before.finished, false],
  ]
  const fired = triggers.filter(([, hit]) => hit)
  return { fired: fired.map(([id]) => id), urgent: fired.some(([, , urgent]) => urgent) }
}

/**
 * Whether a message is due at this tick, and the open burst to keep. Due when a trigger fired since the last
 * send, the key differs from the last key sent, and the key held for one tick, or 60 s passed since the burst
 * began, or a trigger is urgent.
 */
export function nextActionDue(
  marks: NextActionMarks, view: { key: string; snapshot: NextActionSnapshot }, now: number,
): { due: boolean; pending: NextActionMarks['pending'] } {
  const { fired, urgent } = triggersOf(marks.snapshot, view.snapshot)
  if (fired.length === 0 || view.key === marks.key) return { due: false, pending: null }
  const firstAt = marks.pending?.firstAt ?? now
  const held = marks.pending?.key === view.key ? marks.pending.held + 1 : 0
  return { due: urgent || held >= 1 || now - firstAt >= BURST_CAP_MS, pending: { firstAt, key: view.key, held } }
}

/** The prompt-box draft as the last tick saw it, and for how many ticks it stayed the same. */
export type DraftMark = { text: string; still: number }

/** A draft that stayed the same for this many ticks (30 s) is left behind, not typed. */
const DRAFT_LEFT_TICKS = 2

/**
 * Whether the human is typing. A draft that changed since the last tick holds the message; one unchanged for
 * `DRAFT_LEFT_TICKS` ticks counts as left behind, so a human who walked away still gets the message.
 */
export function draftHeld(prev: DraftMark | null, text: string): { mark: DraftMark | null; held: boolean } {
  if (text === '') return { mark: null, held: false }
  const still = prev !== null && prev.text === text ? prev.still + 1 : 0
  return { mark: { text, still }, held: still < DRAFT_LEFT_TICKS }
}

const HEADER =
  `${NEXT_ACTION_PREFIX}. Tell the human every fact in the block below, in your own words: ` +
  'where the run stands, what waits on them with its card id, what runs now with time spent, ' +
  'what comes next. You may reorder and merge, add context from the changes listed, and link it to ' +
  'the topic you and the human just discussed. Always reply; never drop a fact. ' +
  'Every run fact you tell comes from the block, the change list or a queue read; ' +
  'never add a run fact from elsewhere, and mark a guess as a guess. ' +
  'You may call queue. Call no other tool.'

/** The prompt the mod submits: the header, the block, the change list. */
export function nextActionPrompt(block: string, changes: string[]): string {
  const list = changes.length > 0 ? changes.map(c => `- ${c}`) : ['- none']
  return [HEADER, '---', block, '---', 'Changes since the last message:', ...list].join('\n')
}
