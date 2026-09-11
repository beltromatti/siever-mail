/**
 * Physical measurements of the dense table, shared between the component
 * that draws it and the layout that sizes the pane around it.
 *
 * The outlook layout has to guarantee a minimum number of visible rows — the
 * SIEVER team works from roughly fifteen at a glance — while handing every
 * spare pixel to the message below. That calculation is only honest if it
 * derives from the row height the table actually renders, so the number
 * lives here once instead of being duplicated as a magic value in a grid
 * template.
 */

/** Height of one message row in the dense table. */
export const MESSAGE_TABLE_ROW_HEIGHT_PX = 26

/** Panel header: title, counters and the sort / group / select controls. */
const MESSAGE_TABLE_PANEL_HEADER_PX = 36

/** The sortable column header — Da / A / Oggetto / Ricevuto / Dimensione. */
const MESSAGE_TABLE_COLUMN_HEADER_PX = 24

/** One "Oggi" / "Ieri" / per-sender band. */
export const MESSAGE_SECTION_HEADING_HEIGHT_PX = 24

/**
 * Section bands to budget for when sizing the pane. Grouping is on by
 * default, and a typical screenful straddles two of them — measuring the
 * pane without allowing for those is what made a nominal fifteen rows come
 * out as thirteen.
 */
const MESSAGE_TABLE_BUDGETED_SECTION_HEADINGS = 2

/**
 * The panel's own top and bottom hairlines, plus a pixel of slack for
 * subpixel rounding. Without it the arithmetic lands on exactly N rows and
 * the last one comes out a fraction short, so the pane shows N-1.
 */
const MESSAGE_TABLE_BORDER_SLACK_PX = 4

/**
 * Everything inside the table panel that is not a message row.
 */
export const MESSAGE_TABLE_CHROME_HEIGHT_PX =
  MESSAGE_TABLE_PANEL_HEADER_PX +
  MESSAGE_TABLE_COLUMN_HEADER_PX +
  MESSAGE_TABLE_BUDGETED_SECTION_HEADINGS * MESSAGE_SECTION_HEADING_HEIGHT_PX +
  MESSAGE_TABLE_BORDER_SLACK_PX

/**
 * Rows the table aims to show whenever the window can afford them. The
 * customer put the useful floor at fourteen ("è suff che si rimangano in
 * alto 14 righe") and asked for more room below at the same time; fifteen
 * satisfies both because the reading header was cut from 151px to 66px, so
 * the extra row comes out of chrome we removed rather than out of the
 * message. Note this is an aim, not a guarantee: a window too short to
 * honour it gives up rows rather than starving the reader — see
 * `MESSAGE_TABLE_MAX_SPLIT_SHARE`.
 */
export const MESSAGE_TABLE_MIN_VISIBLE_ROWS = 15

/**
 * Rows beyond which extra height is better spent on the message. On a tall
 * display the table would otherwise keep growing to thirty-odd rows nobody
 * reads while the reading pane stays cramped.
 */
export const MESSAGE_TABLE_MAX_VISIBLE_ROWS = 20

/**
 * Share of the split the table may never exceed, so a short window — the
 * 700px minimum, or a half-height window on a laptop — degrades by showing
 * fewer rows instead of squeezing the message down to its header.
 */
export const MESSAGE_TABLE_MAX_SPLIT_SHARE = '62%'

/** Pane height that fits exactly `rows` message rows plus the table chrome. */
export function messageTablePaneHeight(rows: number): number {
  return rows * MESSAGE_TABLE_ROW_HEIGHT_PX + MESSAGE_TABLE_CHROME_HEIGHT_PX
}
