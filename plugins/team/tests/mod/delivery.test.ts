import { describe, expect, test } from 'claude-code/testing'
import { testing } from '../../hooks/mod/team'
import { DIALOG_TEXT, start, team } from './world'

const entry = (n: number) => ({
  n, answer: `Answer ${n}.`, rationale: 'r', overrides: [], at: 0,
  cards: [{ id: 'Q-1', from: 'app-1-scout', tag: 'fixtures' }],
})

const deferred = () => {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TICK = 15000
const held = (path: string) =>
  `WATCH delivered.json does not parse: ${path} - REPORT and DECISION delivery held until it is fixed`
const count = (w: { submits: string[] }, n: number) => w.submits.filter(s => s.includes(`DECISION ${n} `)).length
const RECOVERED ='WATCH delivered.json parses again: REPORT and DECISION delivery resumed'

describe('delivery while the orchestrator is busy', () => {
  test('a submit held open is sent once, and its marks are written before it resolves', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, {})
    w.writeJson(`${w.team}/decisions/9.json`, entry(9))
    const held = deferred()
    w.holdSubmits = [held.promise]
    for (let i = 0; i < 4; i++) await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(1)
    expect(w.json(delivered)).toMatchObject({ _decision: 9 })

    held.resolve()
    w.writeJson(`${w.team}/decisions/10.json`, entry(10))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(2)
    expect(w.submits[1]).toContain('DECISION 10 ')
    expect(w.submits[1]).not.toContain('DECISION 9 ')
  })

  test('a tick that overlaps a running one does nothing', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    const held = deferred()
    w.holdList = held.promise
    for (let i = 0; i < 3; i++) await w.clock.advance(TICK)
    const lists = () => w.runs.filter(argv => argv.slice(1, 3).join(' ') === 'agent list')
    expect(lists()).toHaveLength(1)
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(TICK)
    expect(w.submits).toEqual([])

    held.resolve()
    await w.clock.advance(TICK)
    expect(lists().length).toBeGreaterThan(1)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0]).toContain('DECISION 1 ')
  })

  test('a tick that threw still frees the next one', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.writeFails = true
    await w.clock.advance(TICK)
    expect(w.writeFails).toBe(false)
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(w.submits.filter(s => s.includes('DECISION 1 '))).toHaveLength(1)
  })

  test('marks on disk that are newer than the tick start survive its write', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, { _decision: 6 })
    w.writeJson(`${w.team}/decisions/7.json`, entry(7))
    let raced = false
    w.afterRead = p => {
      if (p === delivered && !raced) {
        raced = true
        w.writeJson(delivered, { _decision: 9 })
      }
    }
    await w.clock.advance(TICK)
    expect(w.json(delivered)._decision).toBe(9)
  })

  test('a held submit that is rejected is sent again by the next tick, once', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    const held = deferred()
    w.holdSubmits = [held.promise]
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(1)
    expect(w.json(delivered)._decision).toBe(1)

    held.reject(new Error('refused late'))
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(2)
    expect(w.json(delivered)._decision).toBe(1)
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(2)
  })

  test('a late rejection of an older send re-sends its lines after a newer send raised the same mark', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    const first = deferred()
    const second = deferred()
    w.holdSubmits = [first.promise, second.promise]
    await w.clock.advance(TICK)
    w.writeJson(`${w.team}/decisions/2.json`, entry(2))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(2)

    first.reject(new Error('refused late'))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(3)
    expect(w.submits[2]).toContain('DECISION 1 ')
    expect(w.submits[2]).not.toContain('DECISION 2 ')
    second.resolve()
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(3)
  })

  test('a rejection never lowers a mark on disk', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    const first = deferred()
    const second = deferred()
    w.holdSubmits = [first.promise, second.promise]
    await w.clock.advance(TICK)
    w.writeJson(`${w.team}/decisions/2.json`, entry(2))
    await w.clock.advance(TICK)
    const before = w.json(delivered)
    expect(before._decision).toBe(2)

    first.reject(new Error('refused late'))
    await w.clock.advance(TICK)
    const after = w.json(delivered)
    for (const [key, mark] of Object.entries(before)) {
      if (typeof mark === 'number') expect(after[key]).toBeGreaterThanOrEqual(mark)
      else expect(after[key]).toBe(mark)
    }
    second.resolve()
  })

  test('retry lines go first in the next bundle, before the new lines', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.submitFails = true
    await w.clock.advance(TICK)
    w.writeJson(`${w.team}/decisions/2.json`, entry(2))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(1)
    const bundle = w.submits[0] ?? ''
    expect(bundle.indexOf('DECISION 1 ')).toBeGreaterThanOrEqual(0)
    expect(bundle.indexOf('DECISION 1 ')).toBeLessThan(bundle.indexOf('DECISION 2 '))
    expect(count(w, 1)).toBe(1)
    expect(count(w, 2)).toBe(1)
  })

  test('a rejected retry bundle is retried again on the next tick, once', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    const first = deferred()
    const retry = deferred()
    w.holdSubmits = [first.promise, retry.promise]
    await w.clock.advance(TICK)
    first.reject(new Error('refused late'))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(2)

    retry.reject(new Error('refused again'))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(3)
    expect(count(w, 1)).toBe(3)
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(3)
  })

  test('a rejected line is re-sent after a session.start', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.submitFails = true
    await w.clock.advance(TICK)
    expect(w.submits).toEqual([])
    await start($)
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(1)
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(1)
  })

  test('a status update that throws after a good submit puts no line in the retry list', async () => {
    testing.reset()
    testing.setBadge('prompt not sent: earlier')
    const sent: string[] = []
    const fake = {
      prompt: { submit: async (p: { text: string }) => { sent.push(p.text); return p } },
      ui: { status: async () => { throw new Error('status broke') } },
    }
    let thrown: unknown = null
    try {
      await testing.sendLines(fake as never, ['DECISION 1 x'], true)
    } catch (err) {
      thrown = err
    }
    const kept = testing.retryLines()
    testing.reset()
    expect(sent).toEqual(['DECISION 1 x'])
    expect(kept).toEqual([])
    expect(String(thrown)).toContain('status broke')
  })

  test('a delivered.json that does not parse holds REPORT and DECISION lines, and says so once', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    for (const n of [1, 2, 3]) w.writeJson(`${w.team}/decisions/${n}.json`, entry(n))
    w.write(delivered, '{"_decision":3')
    for (let i = 0; i < 3; i++) await w.clock.advance(TICK)
    expect(w.submits).toEqual([held(delivered)])
    expect(w.files.get(delivered)?.text).toBe('{"_decision":3')

    w.writeJson(delivered, { _decision: 3 })
    await w.clock.advance(TICK)
    expect(w.submits).toEqual([held(delivered), RECOVERED])
    w.writeJson(`${w.team}/decisions/4.json`, entry(4))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(3)
    expect(w.submits[2]).toContain('DECISION 4 ')
    expect(w.submits[2]).not.toContain('DECISION 1 ')
  })

  test('a missing delivered.json is still a first run', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(1)
  })

  // A guard, not a red test: the mock world cannot make the error display throw (the engine drops a failed
  // $.ui.status, and the atom update has no hook), so this only pins that a failed send leaves nothing unhandled.
  test('a failed send leaves no unhandled rejection, and the next tick runs', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/delivered.json`, {})
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    const unhandled: unknown[] = []
    const listener = (event: { reason?: unknown }) => unhandled.push(event.reason)
    const target = globalThis as unknown as {
      addEventListener?: (type: string, fn: typeof listener) => void
      removeEventListener?: (type: string, fn: typeof listener) => void
    }
    target.addEventListener?.('unhandledrejection', listener)
    try {
      w.submitFails = true
      await w.clock.advance(TICK)
      for (let i = 0; i < 20; i++) await Promise.resolve()
      w.writeJson(`${w.team}/decisions/2.json`, entry(2))
      await w.clock.advance(TICK)
      expect(unhandled).toEqual([])
      expect(count(w, 2)).toBe(1)
    } finally {
      target.removeEventListener?.('unhandledrejection', listener)
    }
  })
})

describe('a broken delivered.json does not stop the rest of the tick', () => {
  const MIN = 60_000
  const sub = (argv: string[]) => argv.slice(1, 3).join(' ')
  const closes = (w: { runs: string[][] }) => w.runs.filter(a => sub(a) === 'pane close').map(a => a[3])
  const releases = (w: { runs: string[][] }) => w.runs.filter(a => (a[0] ?? '').endsWith('/bin/team-release')).map(a => a[1])
  const lines = (w: { submits: string[] }) => w.submits.flatMap(s => s.split('\n'))
  const BLOCKED = `WATCH app-1-scout: working -> blocked: ${DIALOG_TEXT}`

  /** A reported, idle worker in a team tab whose release timer started `idleMs` before the first tick. */
  async function idleWorker($: any, on: any, idleMs: number) {
    const w = await team($, on)
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-.md`, 'REPORT app-1-scout x: done\n', 1000)
    w.agents = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle', agent_session: { value: 'sid-scout' } }]
    w.panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'idle' }]
    w.writeJson(`${w.team}/tabs.json`, ['w1:t2'])
    const first = w.clock.now() + TICK
    w.writeJson(`${w.team}/watch-state.json`, {
      agents: { 'app-1-scout': 'idle' }, _flagged: {}, _idle_since: {}, _release_since: { 'app-1-scout': first - idleMs },
    })
    return w
  }

  test('a blocked line still goes out, and the held line is not repeated', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.write(delivered, '{"_decision":')
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(TICK)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(lines(w).filter(l => l === held(delivered))).toHaveLength(1)
    expect(lines(w).filter(l => l.startsWith(BLOCKED))).toHaveLength(1)
  })

  test('an empty record-named pane is still closed', async ($, on) => {
    const w = await team($, on)
    w.write(`${w.team}/delivered.json`, '')
    w.panes = [{ pane_id: 'w1:p2', tab_id: 'w1:t2', agent_status: 'unknown' }]
    w.writeJson(`${w.team}/tabs.json`, ['w1:t2'])
    await w.clock.advance(TICK)
    expect(closes(w)).toEqual(['w1:p2'])
  })

  test('a due agent is still released', async ($, on) => {
    const w = await idleWorker($, on, 30 * MIN)
    w.write(`${w.team}/delivered.json`, 'not json')
    await w.clock.advance(TICK)
    expect(releases(w)).toEqual(['app-1-scout'])
    expect(lines(w)).toContain('released app-1-scout (w1:p2) after 30 min idle')
  })

  test('recovery resets the release timers, as the herdr-down path does', async ($, on) => {
    const w = await idleWorker($, on, 30 * MIN - TICK * 2)
    const delivered = `${w.team}/delivered.json`
    w.write(delivered, 'not json')
    await w.clock.advance(TICK)
    w.writeJson(delivered, {})
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(releases(w)).toEqual([])
    expect(lines(w)).toContain(RECOVERED)
  })

  test('DECISION lines that arrived during the outage are sent once after recovery', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.write(delivered, '{')
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(0)
    w.writeJson(delivered, { _decision: 0 })
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(count(w, 1)).toBe(1)
  })

  test('a failed commit still delivers this tick\'s WATCH lines, and the held lines go out after it', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, {})
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'working', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(TICK)
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.writeFailsAt.add(delivered)
    w.agents = [{ pane_id: 'w1:p2', agent_status: 'blocked', agent_session: { value: 'sid-scout' } }]
    await w.clock.advance(TICK)
    expect(lines(w).filter(l => l.startsWith(BLOCKED))).toHaveLength(1)
    expect(count(w, 1)).toBe(0)

    w.writeFailsAt.clear()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(lines(w).filter(l => l.startsWith(BLOCKED))).toHaveLength(1)
    expect(count(w, 1)).toBe(1)
  })

  test('a file that exists but cannot be read does not replay old decisions', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    for (const n of [1, 2, 3]) w.writeJson(`${w.team}/decisions/${n}.json`, entry(n))
    w.writeJson(delivered, { _decision: 3 })
    w.unreadable.add(delivered)
    await w.clock.advance(TICK)
    expect(w.submits.join('\n')).not.toMatch(/DECISION \d+ /)
    w.unreadable.clear()
    await w.clock.advance(TICK)
    await w.clock.advance(TICK)
    expect(w.submits.join('\n')).not.toMatch(/DECISION \d+ /)
  })

  test('an empty delivered.json counts as unreadable', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.write(delivered, '')
    await w.clock.advance(TICK)
    expect(w.submits).toEqual([held(delivered)])
    expect(w.files.get(delivered)?.text).toBe('')
  })
})

describe('JSON state is written through a temp file and a rename', () => {
  test('delivered.json is written to a temp name and moved over the old one', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, { _decision: 0 })
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    await w.clock.advance(TICK)
    const moves = w.runs.filter(a => a[0] === 'mv' && a[2] === delivered)
    expect(moves).toHaveLength(1)
    expect(moves[0]?.[1]).toMatch(new RegExp(`^${delivered.replace(/[.]/g, '\\.')}\\.tmp-.+`))
    expect(w.json(delivered)._decision).toBe(1)
    expect([...w.files.keys()].filter(p => p.includes('.tmp-'))).toEqual([])
  })

  test('a rename that fails leaves the old file intact and sends no DECISION line', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, { _decision: 0 })
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.fails.set('mv', 'disk full')
    await w.clock.advance(TICK)
    expect(w.files.get(delivered)?.text).toBe('{"_decision":0}')
    expect(w.submits.join('\n')).not.toMatch(/DECISION \d+ /)
  })

  test('a write that fails on the temp file leaves the old file intact', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    w.writeJson(delivered, { _decision: 0 })
    w.writeJson(`${w.team}/decisions/1.json`, entry(1))
    w.writeFailsAt.add(delivered)
    await w.clock.advance(TICK)
    expect(w.files.get(delivered)?.text).toBe('{"_decision":0}')
    expect(w.submits.join('\n')).not.toMatch(/DECISION \d+ /)
  })
})
