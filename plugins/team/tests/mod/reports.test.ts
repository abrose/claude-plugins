import { describe, expect, test } from 'claude-code/testing'
import { mergeMarks, pickReports, reportLine } from '../../hooks/mod/reports'
import { team } from './world'

const report = (body: string) => `# Report: x / t\n- Brief: b\n\n---\n\n${body}\n`

describe('reportLine', () => {
  test('finds a REPORT line after a status bar', () => {
    expect(reportLine('| bar |\n\nREPORT a t: done\nmore')).toBe('REPORT a t: done')
  })
  test('none without one', () => {
    expect(reportLine('waiting on subagents')).toBeNull()
  })
})

describe('pickReports', () => {
  test('a missing delivered file is a baseline: marks, sends nothing', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 5, text: report('REPORT a t: old') }], null)
    expect(r).toEqual({ lines: [], delivered: { a: 5 } })
  })
  test('sends a newer report once', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('REPORT a t: new') }], { a: 5 })
    expect(r).toEqual({ lines: ['REPORT a t: new'], delivered: { a: 9, '_line:a': 'REPORT a t: new' } })
  })
  test('a newer file with the line already sent is marked, not sent', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('REPORT a t: new') }], { a: 5, '_line:a': 'REPORT a t: new' })
    expect(r).toEqual({ lines: [], delivered: { a: 9, '_line:a': 'REPORT a t: new' } })
  })
  test('a changed line is sent and remembered', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('REPORT a t: rev2') }], { a: 5, '_line:a': 'REPORT a t: new' })
    expect(r).toEqual({ lines: ['REPORT a t: rev2'], delivered: { a: 9, '_line:a': 'REPORT a t: rev2' } })
  })
  test('a newer report without a REPORT line is marked, not sent', () => {
    const r = pickReports([{ name: 'a', mtimeMs: 9, text: report('pausing') }], { a: 5 })
    expect(r).toEqual({ lines: [], delivered: { a: 9 } })
  })
})

describe('mergeMarks', () => {
  test('a decision mark on disk above the snapshot stays', () => {
    expect(mergeMarks({ _decision: 9 }, { _decision: 6 })).toEqual({ _decision: 9 })
  })
  test('a report mark on disk above the snapshot stays', () => {
    expect(mergeMarks({ a: 900, b: 5 }, { a: 500, b: 7 })).toEqual({ a: 900, b: 7 })
  })
  test('keys on one side only are kept; a missing file is the snapshot', () => {
    expect(mergeMarks({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
    expect(mergeMarks(null, { b: 2 })).toEqual({ b: 2 })
  })
  test('a remembered line is the incoming one', () => {
    expect(mergeMarks({ '_line:a': 'old' }, { '_line:a': 'new' })).toEqual({ '_line:a': 'new' })
  })
})

describe('pickup in the tick', () => {
  test('an identical REPORT line written again is consumed, a changed one is sent', async ($, on) => {
    const w = await team($, on)
    const path = `${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(path, report('REPORT app-1-scout dig: done'))
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)

    w.write(path, report('REPORT app-1-scout dig: done'))
    const rewritten = w.files.get(path)!.mtimeMs
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
    expect(w.json(`${w.team}/delivered.json`)['app-1-scout']).toBe(rewritten)

    w.write(path, report('REPORT app-1-scout dig: rev2 done'))
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['REPORT app-1-scout dig: done', 'REPORT app-1-scout dig: rev2 done'])
  })

  test('two reports in one tick become one prompt, sent once', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-maker.json`, { role: 'implementer', topic: 'build', brief: '', pane: 'w1:p3', session: 'sid-maker' })
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: found it'))
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-maker-build.md`, report('REPORT app-1-maker build: green'))
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0]!.split('\n').sort()).toEqual([
      'REPORT app-1-maker build: green', 'REPORT app-1-scout dig: found it',
    ])
    await w.clock.advance(15000)
    expect(w.submits).toHaveLength(1)
  })

  test('first activation with old reports sends nothing', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: old'))
    await w.clock.advance(15000)
    expect(w.submits).toEqual([])
    expect(w.json(`${w.team}/delivered.json`)).toHaveProperty('app-1-scout')
  })

  test('a REPORT whose submit failed is sent on the next tick', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    w.writeJson(`${w.team}/delivered.json`, {})
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: found it'))
    w.submitFails = true
    await w.clock.advance(15000)
    expect(w.submits).toEqual([])
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['REPORT app-1-scout dig: found it'])
  })

  test('a report written after the baseline is sent', async ($, on) => {
    const w = await team($, on)
    w.writeJson(`${w.team}/app-1-scout.json`, { role: 'investigator', topic: 'dig', brief: '', pane: 'w1:p2', session: 'sid-scout' })
    await w.clock.advance(15000)
    w.write(`${w.cwd}/scratchpad/current/reports/app-1-scout-dig.md`, report('REPORT app-1-scout dig: fresh'))
    await w.clock.advance(15000)
    expect(w.submits).toEqual(['REPORT app-1-scout dig: fresh'])
  })
})
