import { describe, expect, it } from 'vitest'

import {
  MESSAGE_SECTION_HEADING_HEIGHT_PX,
  MESSAGE_TABLE_CHROME_HEIGHT_PX,
  MESSAGE_TABLE_MAX_SPLIT_SHARE,
  MESSAGE_TABLE_MAX_VISIBLE_ROWS,
  MESSAGE_TABLE_MIN_VISIBLE_ROWS,
  MESSAGE_TABLE_ROW_HEIGHT_PX,
  messageTablePaneHeight
} from './message-list-metrics'

describe('messageTablePaneHeight', () => {
  it('adds one row height per requested row on top of the fixed chrome', () => {
    const oneMore =
      messageTablePaneHeight(MESSAGE_TABLE_MIN_VISIBLE_ROWS + 1) -
      messageTablePaneHeight(MESSAGE_TABLE_MIN_VISIBLE_ROWS)

    expect(oneMore).toBe(MESSAGE_TABLE_ROW_HEIGHT_PX)
  })

  it('budgets for the panel header, the column header and two section bands', () => {
    // The pane that fits zero rows is exactly the chrome, and the chrome has
    // to allow for the grouping bands: sizing it without them is what made a
    // nominal fifteen rows render as thirteen.
    expect(messageTablePaneHeight(0)).toBe(MESSAGE_TABLE_CHROME_HEIGHT_PX)
    expect(MESSAGE_TABLE_CHROME_HEIGHT_PX).toBeGreaterThanOrEqual(
      2 * MESSAGE_SECTION_HEADING_HEIGHT_PX
    )
  })
})

describe('the outlook split invariants', () => {
  it('keeps the floor below the ceiling so the clamp stays well formed', () => {
    // A clamp whose floor exceeds its ceiling silently collapses to the
    // floor, which would pin the table at one size for every window.
    expect(MESSAGE_TABLE_MIN_VISIBLE_ROWS).toBeLessThan(MESSAGE_TABLE_MAX_VISIBLE_ROWS)
    expect(messageTablePaneHeight(MESSAGE_TABLE_MIN_VISIBLE_ROWS)).toBeLessThan(
      messageTablePaneHeight(MESSAGE_TABLE_MAX_VISIBLE_ROWS)
    )
  })

  it('honours the fifteen rows the customer asked to keep at a glance', () => {
    expect(MESSAGE_TABLE_MIN_VISIBLE_ROWS).toBeGreaterThanOrEqual(15)
  })

  it('never lets the table take the whole split', () => {
    // The cap is the safety valve for short windows: without it the row
    // floor would win and leave the reading pane with nothing.
    const share = Number(MESSAGE_TABLE_MAX_SPLIT_SHARE.replace('%', ''))

    expect(MESSAGE_TABLE_MAX_SPLIT_SHARE).toMatch(/^\d+%$/)
    expect(share).toBeGreaterThan(50)
    expect(share).toBeLessThan(70)
  })
})
