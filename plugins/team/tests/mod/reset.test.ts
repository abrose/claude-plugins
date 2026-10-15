import { describe, expect, test } from 'claude-code/testing'
import {
  AUTOCOMPACT_SHARE, canCompact, COMPACT_INSTRUCTIONS, compactWhenIdle, contextPercent, handoverVerdict,
  HANDOVER_MAX_AGE_MS, noteMainTurn, nudgeLimit, nudgeLines, nudgeStep, requestReset, clearResetState,
  RESUME_LINE, withHandoverInstructions, WINDOW_SHARE,
} from '../../hooks/mod/reset'
import type { ContextFigures, ResetPort } from '../../hooks/mod/reset'
import { testing } from '../../hooks/mod/team'
import { call, start, team, world } from './world'

const TICK = 15000
const HANDOVER = (w: { team: string }) => `${w.team.replace(/\/\.team$/, '')}/orch-handover.md`
/** A one-message transcript: the engine call of a compact needs one, and a compaction leaves at least one. */
const MESSAGES = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
/** The lines of every prompt the mod submitted, one entry per line. */
const sentLines = (w: { submits: string[] }) => w.submits.flatMap(s => s.split('\n'))
/** The RESUME lines the mod submitted. */
const resumeLines = (w: { submits: string[] }) => sentLines(w).filter(l => l.startsWith('RESUME after compact:'))

const portOf = (figures: ContextFigures, compact: ResetPort['compact'] = async () => ({})): ResetPort => ({
  figures: async () => figures,
  compact,
})

const IDLE = { retryLines: 0, sendsInFlight: 0 }
const NO_RESUME = () => {}

describe('nudge threshold', () => {
  test('uses autoCompactThreshold when it is present', async () => {
    expect(nudgeLimit({ window: 200000, autoCompactThreshold: 150000 })).toBe(150000 * AUTOCOMPACT_SHARE)
    expect(AUTOCOMPACT_SHARE).toBe(0.7)
  })

  test('uses the window when no auto-compact threshold exists', async () => {
    expect(nudgeLimit({ window: 200000 })).toBe(200000 * WINDOW_SHARE)
    expect(WINDOW_SHARE).toBe(0.6)
  })

  test('measures the percent against the compact window, as /context does (live figures)', async () => {
    // The live set of the tester: 234k tokens, a 1M model window, a 350k compact window, threshold 317k.
    // Tokens over the model window gave 23; /context and the status line showed about 67.
    const live: ContextFigures = { tokens: 234000, window: 1000000, compactWindow: 350000, autoCompactThreshold: 317000 }
    expect(contextPercent(live)).toBe(67)
    expect(contextPercent(live)).not.toBe(23)
  })

  test('falls back to the model window when the compact window is absent or empty', async () => {
    expect(contextPercent({ window: 200000, tokens: 100000 })).toBe(50)
    expect(contextPercent({ window: 200000, tokens: 100000, compactWindow: 0 })).toBe(50)
    expect(contextPercent({ window: 200000, tokens: 100000, compactWindow: 100000 })).toBe(100)
  })

  test('is null while no response measured the context, or when no window is known', async () => {
    expect(contextPercent({ window: 200000 })).toBeNull()
    expect(contextPercent({ window: 200000, compactWindow: 100000 })).toBeNull()
    expect(contextPercent({ window: 0, tokens: 1000 })).toBeNull()
  })
})

describe('nudge step', () => {
  const figures = (tokens?: number): ContextFigures => ({ window: 200000, autoCompactThreshold: 100000, tokens })

  test('fires once per crossing', async () => {
    let armed = true
    const below = nudgeStep(armed, figures(60000))
    expect(below).toEqual({ send: false, armed: true })
    const crossed = nudgeStep(armed, figures(70000))
    expect(crossed).toEqual({ send: true, armed: false })
    armed = crossed.armed
    expect(nudgeStep(armed, figures(80000))).toEqual({ send: false, armed: false })
  })

  test('re-arms once the context falls below the limit again', async () => {
    const low = nudgeStep(false, figures(10000))
    expect(low).toEqual({ send: false, armed: true })
    expect(nudgeStep(low.armed, figures(75000)).send).toBe(true)
  })

  test('an unknown reading changes nothing', async () => {
    expect(nudgeStep(true, figures(undefined))).toEqual({ send: false, armed: true })
    expect(nudgeStep(false, figures(undefined))).toEqual({ send: false, armed: false })
  })
})

describe('nudge line through the port', () => {
  test('sends one line per crossing and again after a compact re-arms it', async () => {
    clearResetState()
    const figures: ContextFigures = { window: 200000, autoCompactThreshold: 100000, tokens: 75000 }
    const port = portOf(figures)
    const first = await nudgeLines(port)
    expect(first).toEqual([
      'WATCH context 38 percent: reach a safe point, write scratchpad/current/orch-handover.md, then call reset_self',
    ])
    expect(await nudgeLines(port)).toEqual([])
    figures.tokens = 5000
    expect(await nudgeLines(port)).toEqual([])
    figures.tokens = 80000
    expect(await nudgeLines(port)).toHaveLength(1)
  })

  test('names the percent of the compact window, not of the model window (live figures)', async () => {
    clearResetState()
    const live: ContextFigures = { tokens: 234000, window: 1000000, compactWindow: 350000, autoCompactThreshold: 317000 }
    expect(await nudgeLines(portOf(live))).toEqual([
      'WATCH context 67 percent: reach a safe point, write scratchpad/current/orch-handover.md, then call reset_self',
    ])
  })

  test('sends nothing while a reset request waits', async () => {
    clearResetState()
    requestReset(1)
    expect(await nudgeLines(portOf({ window: 200000, tokens: 190000 }))).toEqual([])
  })

  test('a failing usage call sends nothing', async () => {
    clearResetState()
    const port: ResetPort = { figures: async () => { throw new Error('no session') }, compact: async () => ({}) }
    expect(await nudgeLines(port)).toEqual([])
  })
})

describe('idle gate', () => {
  const ready = { pending: true, turnRunning: false, retryLines: 0, sendsInFlight: 0, compacting: false }

  test('opens only for a pending request on an idle session', async () => {
    expect(canCompact(ready)).toBe(true)
    expect(canCompact({ ...ready, pending: false })).toBe(false)
    expect(canCompact({ ...ready, turnRunning: true })).toBe(false)
    expect(canCompact({ ...ready, retryLines: 1 })).toBe(false)
    expect(canCompact({ ...ready, sendsInFlight: 1 })).toBe(false)
    expect(canCompact({ ...ready, compacting: true })).toBe(false)
  })

  test('compactWhenIdle calls the port with the instructions only when the gate is open', async () => {
    clearResetState()
    const calls: (string | undefined)[] = []
    const port = portOf({ window: 1 }, async i => { calls.push(i); return {} })
    const errors: string[] = []
    const report = async (t: string) => { errors.push(t) }

    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(false)
    requestReset(1)
    noteMainTurn(true)
    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(false)
    noteMainTurn(false)
    expect(await compactWhenIdle(port, { retryLines: 1, sendsInFlight: 0 }, report, NO_RESUME)).toBe(false)
    expect(await compactWhenIdle(port, { retryLines: 0, sendsInFlight: 1 }, report, NO_RESUME)).toBe(false)
    expect(calls).toEqual([])

    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(true)
    expect(calls).toEqual([COMPACT_INSTRUCTIONS])
    // The request is cleared after a resolved call.
    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(false)
    expect(errors).toEqual([])
  })

  test('a resolved compact calls resume once; a skip, a rejection and a closed gate never do', async () => {
    clearResetState()
    let resumes = 0
    const resume = () => { resumes += 1 }
    const ok = portOf({ window: 1 })
    expect(await compactWhenIdle(ok, IDLE, async () => {}, resume)).toBe(false)
    expect(resumes).toBe(0)

    requestReset(1)
    noteMainTurn(true)
    expect(await compactWhenIdle(ok, IDLE, async () => {}, resume)).toBe(false)
    expect(resumes).toBe(0)
    noteMainTurn(false)
    expect(await compactWhenIdle(ok, IDLE, async () => {}, resume)).toBe(true)
    expect(resumes).toBe(1)
    // The request is met: a later tick does not resume again.
    expect(await compactWhenIdle(ok, IDLE, async () => {}, resume)).toBe(false)
    expect(resumes).toBe(1)

    requestReset(2)
    const skipped = portOf({ window: 1 }, async () => ({ skip: 'a PreCompact hook blocked it' }))
    expect(await compactWhenIdle(skipped, IDLE, async () => {}, resume)).toBe(true)
    expect(resumes).toBe(1)

    const refused = portOf({ window: 1 }, async () => { throw new Error('a turn is running') })
    expect(await compactWhenIdle(refused, IDLE, async () => {}, resume)).toBe(true)
    expect(resumes).toBe(1)
  })

  test('the resume line is one line that tells the orchestrator to reload now', async () => {
    expect(RESUME_LINE.startsWith('RESUME after compact: ')).toBe(true)
    expect(RESUME_LINE).not.toContain('\n')
    for (const part of [
      'team-orchestration skill', 'decisions file', 'scratchpad/current/orch-handover.md', 'the plan file',
      'scratchpad/current/orchestration-decisions.md', 'the reports newer than the handover', 'the open cards',
      'scratchpad/current/.team/questions/Q-*.json', 'whose status is open or assumed',
      'then continue from the handover',
    ]) expect(RESUME_LINE).toContain(part)
  })

  test('a rejected compact keeps the request, reports the reason and retries', async () => {
    clearResetState()
    let attempts = 0
    const port = portOf({ window: 1 }, async () => {
      attempts += 1
      if (attempts === 1) throw new Error('a turn is running')
      return {}
    })
    const errors: string[] = []
    const report = async (t: string) => { errors.push(t) }
    requestReset(1)
    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('a turn is running')
    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(true)
    expect(attempts).toBe(2)
    expect(await compactWhenIdle(port, IDLE, report, NO_RESUME)).toBe(false)
  })

  test('a skipped compact keeps the request and reports the reason', async () => {
    clearResetState()
    const port = portOf({ window: 1 }, async () => ({ skip: 'a PreCompact hook blocked it' }))
    const errors: string[] = []
    requestReset(1)
    await compactWhenIdle(port, IDLE, async t => { errors.push(t) }, NO_RESUME)
    expect(errors[0]).toContain('a PreCompact hook blocked it')
    expect(await compactWhenIdle(port, IDLE, async () => {}, NO_RESUME)).toBe(true)
  })
})

describe('instructions', () => {
  test('are appended after the instructions already present', async () => {
    const out = withHandoverInstructions('keep the API list')
    expect(out.startsWith('keep the API list')).toBe(true)
    expect(out).toContain(COMPACT_INSTRUCTIONS)
  })

  test('stand alone when none were given, and are not added twice', async () => {
    expect(withHandoverInstructions(undefined)).toBe(COMPACT_INSTRUCTIONS)
    expect(withHandoverInstructions('')).toBe(COMPACT_INSTRUCTIONS)
    expect(withHandoverInstructions(COMPACT_INSTRUCTIONS)).toBe(COMPACT_INSTRUCTIONS)
  })

  test('name the handover file and the files to read after the compact', async () => {
    for (const part of ['team-orchestration', 'orch-handover.md', 'orchestration-decisions.md', 'decisions file']) {
      expect(COMPACT_INSTRUCTIONS).toContain(part)
    }
  })

  test('name the card files and the field that marks a card open', async () => {
    // The queue tool refuses in the orchestrator session, so the text must say where the cards are.
    expect(COMPACT_INSTRUCTIONS).toContain('scratchpad/current/.team/questions/Q-*.json')
    expect(COMPACT_INSTRUCTIONS).toContain('whose status is open or assumed')
  })
})

describe('handover check', () => {
  const now = 10 * 60 * 1000 + 5000

  test('a missing file is refused', async () => {
    expect(handoverVerdict(null, now)).toContain('does not exist')
  })

  test('a file older than the request minus 10 minutes is refused', async () => {
    expect(handoverVerdict(now - HANDOVER_MAX_AGE_MS - 1, now)).toContain('older than 10 minutes')
  })

  test('a fresh file is accepted', async () => {
    expect(handoverVerdict(now - HANDOVER_MAX_AGE_MS, now)).toBeNull()
    expect(handoverVerdict(now, now)).toBeNull()
  })
})

describe('reset_self tool', () => {
  test('refuses without a handover file and says why', async ($, on) => {
    clearResetState()
    await team($, on)
    const r = await call($, 'reset_self', {})
    expect(r).toMatchObject({ isError: true })
    expect(String(r.result)).toContain('orch-handover.md does not exist')
  })

  test('refuses a stale handover file', async ($, on) => {
    clearResetState()
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover', w.clock.now() - HANDOVER_MAX_AGE_MS - 60000)
    const r = await call($, 'reset_self', {})
    expect(r).toMatchObject({ isError: true })
    expect(String(r.result)).toContain('older than 10 minutes')
  })

  test('records the request and answers with a short confirmation', async ($, on) => {
    clearResetState()
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    const r = await call($, 'reset_self', {})
    expect(r.isError).toBeUndefined()
    expect(String(r.result)).toContain('compact')
  })

  test('refuses outside the orchestrator session', async ($, on) => {
    clearResetState()
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'sid-other',
    })
    w.write(HANDOVER(w), '# handover')
    const r = await call($, 'reset_self', {})
    expect(r).toMatchObject({ isError: true, result: 'reset_self works only in the orchestrator session' })
  })
})

describe('the mod in the orchestrator session', () => {
  test('nudges once per crossing and compacts at the next idle tick after reset_self', async ($, on) => {
    clearResetState()
    const figures = { tokens: 120000, window: 200000, percent: 60 }
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: { ...figures, breakdown: { autoCompactThreshold: 150000, isAutoCompactEnabled: true } },
      },
    }) as never)
    const compacts: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      compacts.push(e.instructions)
      return { messages: MESSAGES }
    })
    const w = await team($, on)
    await w.clock.advance(TICK)
    expect(sentLines(w).filter(l => l.startsWith('WATCH context 60 percent'))).toHaveLength(1)
    await w.clock.advance(TICK)
    expect(sentLines(w).filter(l => l.startsWith('WATCH context'))).toHaveLength(1)
    expect(compacts).toEqual([])

    w.write(HANDOVER(w), '# handover')
    const r = await call($, 'reset_self', {})
    expect(r.isError).toBeUndefined()
    await w.clock.advance(TICK)
    expect(compacts).toHaveLength(1)
    expect(compacts[0]).toContain('orch-handover.md')
    await w.clock.advance(TICK)
    expect(compacts).toHaveLength(1)
  })

  test('the nudge names the percent of the compact window the engine reports (live figures)', async ($, on) => {
    clearResetState()
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        rateLimits: [],
        context: {
          tokens: 234000, window: 1000000, percent: 23,
          breakdown: { autoCompactThreshold: 317000, rawMaxTokens: 350000, isAutoCompactEnabled: true },
        },
      },
    }) as never)
    const w = await team($, on)
    await w.clock.advance(TICK)
    const nudges = sentLines(w).filter(l => l.startsWith('WATCH context'))
    expect(nudges).toHaveLength(1)
    expect(nudges[0]).toContain('WATCH context 67 percent:')
  })

  test('a resolved compact of the mod sends one RESUME line, once', async ($, on) => {
    clearResetState()
    on('session.compact', () => ({ messages: MESSAGES }))
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([RESUME_LINE])
  })

  test('no RESUME line after a skipped compact', async ($, on) => {
    clearResetState()
    on('session.compact', () => ({ skip: 'a PreCompact hook blocked it' }))
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([])
  })

  test('no RESUME line after a rejected compact', async ($, on) => {
    clearResetState()
    on('session.compact', () => {
      throw new Error('a turn is running')
    })
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([])
  })

  test('no RESUME line for a compact of another trigger: auto or a typed /compact', async ($, on) => {
    clearResetState()
    on('session.compact', () => ({ messages: MESSAGES }))
    const w = await team($, on)
    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    await w.clock.advance(TICK)
    await $.session.compact({ trigger: 'manual', messages: MESSAGES } as never)
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([])
  })

  test('a rejected RESUME send is kept and goes out on the next tick', async ($, on) => {
    testing.reset()
    on('session.compact', () => ({ messages: MESSAGES }))
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    w.submitFails = true
    await w.clock.advance(TICK)
    // The refused submit sends nothing: the line waits in the retry list.
    expect(resumeLines(w)).toEqual([])
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([RESUME_LINE])
    expect(testing.retryLines()).toEqual([])
    await w.clock.advance(TICK)
    expect(resumeLines(w)).toEqual([RESUME_LINE])
  })

  test('no compact runs while a turn runs; the next idle tick runs it', async ($, on) => {
    clearResetState()
    const compacts: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      compacts.push(e.instructions)
      return { messages: MESSAGES }
    })
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    await $.turn.start({ text: 'work', turnId: 't1' } as never)
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(compacts).toEqual([])

    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await w.clock.advance(TICK)
    expect(compacts).toHaveLength(1)
  })

  test('a send in flight holds the compact back until it settles', async ($, on) => {
    clearResetState()
    const compacts: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      compacts.push(e.instructions)
      return { messages: MESSAGES }
    })
    const w = await team($, on)
    w.write(HANDOVER(w), '# handover')
    w.writeJson(`${w.team}/delivered.json`, {})
    let release!: () => void
    w.holdSubmits = [new Promise<void>(resolve => { release = resolve })]
    w.writeJson(`${w.team}/decisions/1.json`, {
      n: 1, answer: 'Answer 1.', rationale: 'r', overrides: [], at: 0, cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'x' }],
    })
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(1)
    expect((await call($, 'reset_self', {})).isError).toBeUndefined()
    await w.clock.advance(TICK)
    expect(compacts).toEqual([])

    release()
    await w.clock.advance(TICK)
    expect(compacts).toHaveLength(1)
  })

  test('a compact in another session keeps the instructions as given', async ($, on) => {
    clearResetState()
    const seen: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      seen.push(e.instructions)
      return { messages: MESSAGES }
    })
    const w = world(on)
    await start($)
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch', orchestrator_session: 'sid-other',
    })
    await $.session.compact({ trigger: 'auto', messages: MESSAGES, instructions: 'keep the API list' } as never)
    expect(seen).toEqual(['keep the API list'])
  })

  test('an auto compact gets the handover instructions too', async ($, on) => {
    clearResetState()
    const seen: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      seen.push(e.instructions)
      return { messages: MESSAGES }
    })
    await team($, on)
    await $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
    expect(seen).toEqual([COMPACT_INSTRUCTIONS])
  })

  test('a compact adds the handover instructions to the ones already given', async ($, on) => {
    clearResetState()
    const seen: (string | undefined)[] = []
    on('session.compact', (_$, e) => {
      seen.push(e.instructions)
      return { messages: MESSAGES }
    })
    await team($, on)
    await $.session.compact({ trigger: 'manual', messages: MESSAGES, instructions: 'keep the API list' } as never)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.startsWith('keep the API list')).toBe(true)
    expect(seen[0]).toContain(COMPACT_INSTRUCTIONS)
  })

  test('a received line is appended to the inbox log with a timestamp', async ($, on) => {
    clearResetState()
    on('session.receive', (_$, e) => ({ text: e.text }))
    const w = await team($, on)
    await $.session.receive({ origin: { kind: 'peer' }, text: 'RELAY pick the cap' } as never)
    const log = w.files.get(`${w.team}/inbox.log`)?.text ?? ''
    expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z RELAY pick the cap\n$/)
  })
})
