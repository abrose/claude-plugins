import { describe, expect, test } from 'claude-code/testing'
import { start, team, world } from './world'

const EDDY_ASK = { tool: 'mcp__eddy__ask', tool_use_id: 't1' } as never
const EDDY_BRANCH = { tool: 'mcp__eddy__branch_open', tool_use_id: 't2' } as never
const denyOf = (r: unknown) => (r as { deny?: string }).deny

describe('the eddy mod tools in a team session', () => {
  test('denies an eddy tool call in an active team session and names the team tool', async ($, on) => {
    on('tool.call', { tool: 'mcp__eddy__ask' }, () => ({ result: 'eddy answered' }))
    const w = await team($, on)

    expect(denyOf(await $.tool.call(EDDY_ASK))).toContain('mcp__team__ask')

    w.id = 'sid-scout'
    expect(denyOf(await $.tool.call(EDDY_ASK))).toContain('mcp__team__ask')
  })

  test('passes an eddy tool call on in a session the team is not active in', async ($, on) => {
    on('tool.call', { tool: 'mcp__eddy__ask' }, () => ({ result: 'eddy answered' }))
    world(on)
    await start($)

    expect(await $.tool.call(EDDY_ASK)).toMatchObject({ result: 'eddy answered' })
  })

  test('lets an eddy tool call go on when the team-active check throws (fails open)', async ($, on) => {
    on('tool.call', { tool: 'mcp__eddy__ask' }, () => ({ result: 'eddy answered' }))
    const w = await team($, on)
    let throws = 0
    w.afterRead = () => {
      throws += 1
      throw new Error('disk gone')
    }

    expect(await $.tool.call(EDDY_ASK)).toMatchObject({ result: 'eddy answered' })
    expect(throws).toBeGreaterThan(0)
  })

  test('denies an eddy branch tool and says it has no team equivalent', async ($, on) => {
    on('tool.call', { tool: 'mcp__eddy__branch_open' }, () => ({ result: 'eddy answered' }))
    await team($, on)

    expect(denyOf(await $.tool.call(EDDY_BRANCH))).toContain('no team equivalent')
  })

  test('leaves other tools alone in an active team session', async ($, on) => {
    on('tool.call', { tool: 'Read' }, () => ({ result: 'read answered' }))
    on('tool.call', { tool: 'mcp__team__ask' }, () => ({ result: 'team answered' }))
    await team($, on)

    const read = await $.tool.call({ tool: 'Read', tool_use_id: 't3' } as never)
    const ask = await $.tool.call({ tool: 'mcp__team__ask', tool_use_id: 't4' } as never)

    expect(denyOf(read)).toBeUndefined()
    expect(denyOf(ask)).toBeUndefined()
  })
})
