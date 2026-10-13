import { describe, expect, test } from 'claude-code/testing'
import { team } from './world'

const asScout = async ($: any, on: any) => {
  const w = await team($, on)
  w.writeJson(`${w.team}/app-1-scout.json`, {
    role: 'investigator', topic: 'fixtures', brief: 'brief-app-1-scout-fixtures.md', pane: 'w1:p2', session: 'sid-scout',
  })
  w.id = 'sid-scout'
  return w
}

const denied = ($: any, tool = 'mcp__gitlab__save_note', reason = 'auto mode: a write to a shared tracker') =>
  $.classic.PermissionDenied({ tool_name: tool, tool_input: {}, tool_use_id: 'tu-1', reason } as never)

describe('the denial hook', () => {
  test('a classic PermissionDenied in a worker session writes its denial mark', async ($, on) => {
    const w = await asScout($, on)

    await denied($)

    expect(w.json(`${w.team}/denials/app-1-scout.json`)).toEqual({
      tool: 'mcp__gitlab__save_note', reason: 'auto mode: a write to a shared tracker', at: w.clock.now(),
    })
  })

  test('a later denial of the same agent replaces its mark', async ($, on) => {
    const w = await asScout($, on)
    await denied($, 'Bash')
    await w.clock.advance(60_000)

    await denied($, 'mcp__gitlab__save_note')

    expect(w.json(`${w.team}/denials/app-1-scout.json`)).toMatchObject({ tool: 'mcp__gitlab__save_note', at: w.clock.now() })
  })

  test('a PermissionDenied in a session with no team record writes nothing', async ($, on) => {
    const w = await asScout($, on)
    w.id = 'sid-stranger'

    await denied($)

    expect([...w.files.keys()].some(p => p.includes('/denials/'))).toBe(false)
  })

  test('the denial hook passes the event on: no retry', async ($, on) => {
    await asScout($, on)

    const result = await denied($)

    expect(result).not.toHaveProperty('retry')
  })

  test('a mark that cannot be written does not break the event', async ($, on) => {
    const w = await asScout($, on)
    w.writeFailsAt.add(`${w.team}/denials/`)

    const result = await denied($)

    expect(result).not.toHaveProperty('retry')
    expect([...w.files.keys()].some(p => p.includes('/denials/'))).toBe(false)
  })

  test('a reason longer than 200 characters is cut', async ($, on) => {
    const w = await asScout($, on)

    await denied($, 'Bash', 'x'.repeat(500))

    expect(w.json(`${w.team}/denials/app-1-scout.json`).reason).toHaveLength(200)
  })
})
