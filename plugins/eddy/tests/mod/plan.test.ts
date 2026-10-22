import { describe, expect, test } from 'claude-code/testing'
import { DONE_CAP, fitPlan, parsePlan } from '../../hooks/mod/plan'

const TEXT = `# APP-1

## DONE
- [x] 1. Analysis - app-1-inv
- [x] 2. Design reviewed

## RUNNING
- [>] 3. Implementation - app-1-impl

## Notes
- [ ] not an item, wrong section

## NEXT
* [ ] 4. Gate
`

describe('parsePlan', () => {
  test('reads title and items per section', () => {
    expect(parsePlan(TEXT)).toEqual({
      title: 'APP-1',
      waits: [],
      done: [{ mark: 'x', text: '1. Analysis - app-1-inv' }, { mark: 'x', text: '2. Design reviewed' }],
      running: [{ mark: '>', text: '3. Implementation - app-1-impl' }],
      next: [{ mark: ' ', text: '4. Gate' }],
    })
  })

  test('matches headings in any case and an upper-case X', () => {
    expect(parsePlan('## done\n- [X] a\n').done).toEqual([{ mark: 'x', text: 'a' }])
  })

  test('sorts items by mark, not by heading, in file order', () => {
    const plan = parsePlan('# T\n\n## DONE\n- [x] a\n\n## RUNNING\n- [x] b\n- [ ] you: c\n\n## NEXT\n- [x] d\n- [>] e\n')
    expect(plan.done.map((i) => i.text)).toEqual(['a', 'b', 'd'])
    expect(plan.running.map((i) => i.text)).toEqual(['e'])
    expect(plan.next.map((i) => i.text)).toEqual(['you: c'])
  })

  test('a [?] item goes to waits, whatever the heading', () => {
    const plan = parsePlan('# T\n\n## WAITS ON YOU\n- [?] 5. Pick the fixture set\n\n## RUNNING\n- [?] 6. Approve the merge\n- [>] 7. Build\n')
    expect(plan.waits).toEqual([
      { mark: '?', text: '5. Pick the fixture set' },
      { mark: '?', text: '6. Approve the merge' },
    ])
    expect(plan.running.map((i) => i.text)).toEqual(['7. Build'])
  })

  test('flipping [?] to [x] in place moves the item to done', () => {
    const waiting = parsePlan('# T\n\n## WAITS ON YOU\n- [?] 5. Pick the fixture set\n')
    expect(waiting.waits).toHaveLength(1)
    const answered = parsePlan('# T\n\n## WAITS ON YOU\n- [x] 5. Pick the fixture set\n')
    expect(answered.waits).toEqual([])
    expect(answered.done).toEqual([{ mark: 'x', text: '5. Pick the fixture set' }])
  })

  test('another unknown mark is still dropped', () => {
    const plan = parsePlan('# T\n\n## RUNNING\n- [!] a\n- [~] b\n')
    expect(plan).toEqual({ title: 'T', waits: [], done: [], running: [], next: [] })
  })
})

describe('fitPlan', () => {
  test('drops the oldest DONE items first', () => {
    const fitted = fitPlan(parsePlan(TEXT), 3)
    expect(fitted.plan.done).toEqual([{ mark: 'x', text: '2. Design reviewed' }])
    expect(fitted.hiddenDone).toBe(1)
    expect(fitted.plan.running).toHaveLength(1)
    expect(fitted.plan.next).toHaveLength(1)
  })

  test('waits take room before DONE and are never cut', () => {
    const plan = parsePlan('# T\n## WAITS ON YOU\n- [?] w1\n- [?] w2\n## DONE\n- [x] a\n- [x] b\n## RUNNING\n- [>] r\n')
    const fitted = fitPlan(plan, 4)
    expect(fitted.plan.waits).toHaveLength(2)
    expect(fitted.plan.done).toEqual([{ mark: 'x', text: 'b' }])
    expect(fitted.hiddenDone).toBe(1)
  })

  test('a tall pane still shows only the newest DONE_CAP items', () => {
    const done = Array.from({ length: 15 }, (_, i) => `- [x] d${i + 1}`).join('\n')
    const plan = parsePlan(`# T\n## DONE\n${done}\n## RUNNING\n- [>] r\n## NEXT\n- [ ] n\n`)
    const fitted = fitPlan(plan, 100)
    expect(fitted.plan.done).toEqual(plan.done.slice(5))
    expect(fitted.plan.done).toHaveLength(DONE_CAP)
    expect(fitted.hiddenDone).toBe(5)
    expect(fitted.plan.running).toHaveLength(1)
    expect(fitted.plan.next).toHaveLength(1)
  })

  test('DONE_CAP items or fewer on a tall pane all show', () => {
    const done = Array.from({ length: 10 }, (_, i) => `- [x] d${i + 1}`).join('\n')
    const plan = parsePlan(`# T\n## DONE\n${done}\n`)
    const fitted = fitPlan(plan, 100)
    expect(fitted.plan.done).toEqual(plan.done)
    expect(fitted.hiddenDone).toBe(0)
  })
})
