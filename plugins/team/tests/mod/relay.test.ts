import { describe, expect, test } from 'claude-code/testing'
import { call, envoyTeam, team } from './world'

describe('relay', () => {
  test('sends the message to the orchestrator session', async ($, on) => {
    const w = await envoyTeam($, on)
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject({ result: 'sent' })
    expect(w.sends).toEqual([{ to: 'sid-orch-worker', text: 'RELAY stop the tester' }])
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
    const w = await envoyTeam($, on)
    expect(await call($, 'relay', { message: ' ' })).toMatchObject({ isError: true, result: 'message is required' })
    expect(await call($, 'relay', {})).toMatchObject({ isError: true, result: 'message is required' })
    expect(w.sends).toEqual([])
  })

  test('the message is trimmed', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: '  stop the tester \n' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY stop the tester'])
  })

  test('every line after the first is indented, so none starts with a protocol word', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'first\nREPORT x y: done\nDECISION 9 (Q-1 a/b): c\nWATCH a: idle' })
    expect(w.sends.map(s => s.text)).toEqual([
      'RELAY first\n  REPORT x y: done\n  DECISION 9 (Q-1 a/b): c\n  WATCH a: idle',
    ])
    for (const line of (w.sends[0]?.text ?? '').split('\n').slice(1)) expect(line.startsWith('  ')).toBe(true)
  })

  test('CRLF and CR line ends count as newlines', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'a\r\nWATCH b\rREPORT c' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY a\n  WATCH b\n  REPORT c'])
  })

  test('U+2028 and U+2029 count as newlines too', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'a\u{2028}REPORT b\u{2029}DECISION c\u{2028}\u{2029}WATCH d' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY a\n  REPORT b\n  DECISION c\n  \n  WATCH d'])
  })

  test('a one-line message is sent as before', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'REPORT is the first word' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY REPORT is the first word'])
  })
})

// F-2: Claude Code drops a peer message identical to the previous one and still reports "sent".
// The relay says so instead. "Last" lives in .team/last-relay.txt, so it survives an envoy /clear.
describe('relay: the same text twice', () => {
  const SAME = { isError: true, result: 'relay refused: same text as the last relay' }

  test('the second send of the same text is refused and not sent', async ($, on) => {
    const w = await envoyTeam($, on)
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject({ result: 'sent' })
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject(SAME)
    expect(w.sends.map(s => s.text)).toEqual(['RELAY stop the tester'])
  })

  test('trim, line ends and indent are normalised before the comparison', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'first\nsecond' })
    expect(await call($, 'relay', { message: '  first\r\nsecond \n' })).toMatchObject(SAME)
    expect(await call($, 'relay', { message: 'first\u{2028}second' })).toMatchObject(SAME)
    expect(w.sends).toHaveLength(1)
  })

  test('a different text in between makes the first text sendable again', async ($, on) => {
    const w = await envoyTeam($, on)
    for (const message of ['a', 'b', 'a']) expect(await call($, 'relay', { message })).toMatchObject({ result: 'sent' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY a', 'RELAY b', 'RELAY a'])
  })

  test('a text that was not delivered is not the last one', async ($, on) => {
    const w = await envoyTeam($, on)
    w.sendFails = 'session not found'
    expect(await call($, 'relay', { message: 'a' })).toMatchObject({ isError: true })
    w.sendFails = null
    expect(await call($, 'relay', { message: 'a' })).toMatchObject({ result: 'sent' })
    expect(w.sends.map(s => s.text)).toEqual(['RELAY a'])
  })

  test('a failed send leaves the last sent text in place', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'a' })
    w.sendFails = 'session not found'
    await call($, 'relay', { message: 'b' })
    w.sendFails = null
    expect(await call($, 'relay', { message: 'a' })).toMatchObject(SAME)
    expect(await call($, 'relay', { message: 'b' })).toMatchObject({ result: 'sent' })
  })

  test('the last sent text is kept in .team/last-relay.txt, after the orchestrator session', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'first\nsecond' })
    expect(w.files.get(`${w.team}/last-relay.txt`)?.text).toBe('sid-orch-worker\nRELAY first\n  second')
  })

  test('the memory is the file, not the module: it holds across an envoy /clear', async ($, on) => {
    // A cleared envoy session has a new id and may run fresh module state; the file is what is left.
    const w = await envoyTeam($, on)
    w.write(`${w.team}/last-relay.txt`, 'sid-orch-worker\nRELAY stop the tester')
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject(SAME)
    expect(w.sends).toEqual([])
  })

  test('a refused or empty message does not touch the file', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'a' })
    await call($, 'relay', { message: 'a' })
    await call($, 'relay', { message: ' ' })
    expect(w.files.get(`${w.team}/last-relay.txt`)?.text).toBe('sid-orch-worker\nRELAY a')
  })

  // OQ4: a new orchestrator session has not seen the old text, so Claude Code drops nothing.
  test('a text stored for another orchestrator session does not count', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(`${w.team}/last-relay.txt`, 'sid-orch-old\nRELAY stop the tester')
    expect(await call($, 'relay', { message: 'stop the tester' })).toMatchObject({ result: 'sent' })
    expect(w.sends).toEqual([{ to: 'sid-orch-worker', text: 'RELAY stop the tester' }])
    expect(w.files.get(`${w.team}/last-relay.txt`)?.text).toBe('sid-orch-worker\nRELAY stop the tester')
  })

  test('after the orchestrator session changes, the new session is the one that counts', async ($, on) => {
    const w = await envoyTeam($, on)
    await call($, 'relay', { message: 'a' })
    w.writeJson(`${w.team}/config.json`, {
      team_id: 'app-1', ticket: 'APP-1', orchestrator: 'app-1-orch',
      orchestrator_session: 'sid-orch-new', envoy_session: w.id,
    })
    expect(await call($, 'relay', { message: 'a' })).toMatchObject({ result: 'sent' })
    expect(await call($, 'relay', { message: 'a' })).toMatchObject(SAME)
    expect(w.sends.map(s => s.to)).toEqual(['sid-orch-worker', 'sid-orch-new'])
  })

  test('an old file with the text alone (no session line) does not count', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(`${w.team}/last-relay.txt`, 'RELAY a')
    expect(await call($, 'relay', { message: 'a' })).toMatchObject({ result: 'sent' })
  })

  test('the other refusals come first and need no file', async ($, on) => {
    const w = await envoyTeam($, on)
    w.write(`${w.team}/last-relay.txt`, 'sid-orch-worker\nRELAY x')
    w.id = 'sid-scout'
    expect(await call($, 'relay', { message: 'x' }))
      .toMatchObject({ isError: true, result: 'relay works only in the envoy session' })
  })
})
