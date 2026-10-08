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
