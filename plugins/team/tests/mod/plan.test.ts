import { describe, expect, test } from 'claude-code/testing'
import { fitPlan, parsePlan } from '../../hooks/mod/plan'

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
      done: [{ mark: 'x', text: '1. Analysis - app-1-inv' }, { mark: 'x', text: '2. Design reviewed' }],
      running: [{ mark: '>', text: '3. Implementation - app-1-impl' }],
      next: [{ mark: ' ', text: '4. Gate' }],
    })
  })

  test('matches headings in any case and an upper-case X', () => {
    expect(parsePlan('## done\n- [X] a\n').done).toEqual([{ mark: 'x', text: 'a' }])
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
})
