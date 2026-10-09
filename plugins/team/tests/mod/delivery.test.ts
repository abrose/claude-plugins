import { describe, expect, test } from 'claude-code/testing'
import { testing } from '../../hooks/mod/team'
import { start, team } from './world'

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

  const count = (w: { submits: string[] }, n: number) => w.submits.filter(s => s.includes(`DECISION ${n} `)).length

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

  test('a delivered.json that does not parse stops the send of that tick', async ($, on) => {
    const w = await team($, on)
    const delivered = `${w.team}/delivered.json`
    for (const n of [1, 2, 3]) w.writeJson(`${w.team}/decisions/${n}.json`, entry(n))
    w.write(delivered, '{"_decision":3')
    for (let i = 0; i < 3; i++) await w.clock.advance(TICK)
    expect(w.submits).toEqual([])
    expect(w.files.get(delivered)?.text).toBe('{"_decision":3')

    w.writeJson(delivered, { _decision: 3 })
    await w.clock.advance(TICK)
    expect(w.submits).toEqual([])
    w.writeJson(`${w.team}/decisions/4.json`, entry(4))
    await w.clock.advance(TICK)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0]).toContain('DECISION 4 ')
    expect(w.submits[0]).not.toContain('DECISION 1 ')
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
