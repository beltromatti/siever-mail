import { useCallback, useEffect, useRef, useState } from 'react'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Redo2,
  Table as TableIcon,
  Undo2,
  Outdent,
  Palette,
  Pilcrow,
  Quote,
  RemoveFormatting,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Strikethrough,
  UnderlineIcon
} from 'lucide-react'

// Loaded as an external `<script src="…">` (NOT inline) so the renderer's
// CSP `script-src 'self'` lets it through. Inline scripts via textContent
// would be blocked silently and Squire would never reach the iframe window.
import squireScriptUrl from 'squire-rte/dist/squire.js?url'

import extensionShared from '@app/extension/shared'
import type { TextColorOption } from '@app/extension/types'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenuCheckboxItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { READER_ZOOM_RESET, wheelReaderZoom } from '@renderer/lib/reader-zoom'
import { buildMailFrameDocument, sanitizeMailHtmlToFragment } from '@renderer/lib/mail-html'
import {
  areMailFontFamiliesEquivalent,
  findMailFontOption,
  getDisplayMailFontFamily,
  MAIL_EDITOR_DEFAULT_FONT_FAMILY,
  MAIL_FONT_OPTIONS,
  normalizeMailFontFamilyValue
} from '@shared/mail-fonts'
import { cn } from '@renderer/lib/utils'

/**
 * What the host can do with the body from outside it. The body is the
 * editor's: the host reads it when it needs it and changes it only through
 * here, each change a step ⌘Z takes back.
 */
export interface RichTextEditorHandle {
  /** The body as it is now, as the message carries it. */
  getHTML(): string
  /**
   * The whole body anew — a deliberate replacement, for a body nobody wrote
   * in yet: the caret goes to the start, the undo history starts again.
   */
  setHTML(html: string): void
  /** Changes the body in place, in its live DOM: the caret stays where it is, unless what it was in goes. */
  modify(change: (root: HTMLElement) => void): void
  /** Puts `html` in place of the selection, or at the caret. */
  insertHTML(html: string): void
  /**
   * The passage selected in the body, kept to be written over later — once
   * the focus has moved to a popover, say: null when nothing is selected.
   */
  captureSelection(): {
    text: string
    /** The line the selection starts in, whose style lines written over it take. */
    block: Element | null
    /**
     * Writes `html` over the passage, if it is still there as it was —
     * false when the user has typed over it, or undone past it, meanwhile.
     * The keyboard stays where the user is.
     */
    replace: (html: string) => boolean
  } | null
  /** Focuses the body; at the start of the node `where` picks, when it picks one. */
  focus(where?: (root: HTMLElement) => Node | null): void
  /**
   * Puts the caret at the start of the node `where` picks without taking
   * the focus: the toolbar shows that line's style, and the caret is there
   * when the body is entered.
   */
  select(where: (root: HTMLElement) => Node | null): void
}

interface RichTextEditorProps {
  /** Filled with the body's handle while the editor is up. */
  handleRef?: React.RefObject<RichTextEditorHandle | null>
  /**
   * What the body opens with. Read once, when the editor is made: from then
   * on the body is the editor's, and changes through the handle.
   */
  initialHtml: string
  placeholder?: string
  disabled?: boolean
  /**
   * `boxed` stands on a page among other things, framed; `pane` fills the
   * pane it is in, its toolbar a band of the pane (the composer).
   */
  variant?: 'boxed' | 'pane'
  expandToContainer?: boolean
  defaultFontFamily?: string
  /** How large the body shows, in percent (`UiPreferences.readerZoom`): the message stays as written. */
  zoom?: number
  /** Ctrl/⌘ + wheel over the body, as over a message being read. */
  onZoomChange?: (zoom: number) => void
  /**
   * A file is being dragged over the body. The editor never takes the drop
   * itself — Chromium would open the file in its frame — so the host can
   * cover it with a drop target of its own.
   */
  onFileDragEnter?: () => void
  /**
   * A block the body keeps whole at its top (the composer's letterhead):
   * Backspace at the start of the line after it does not merge that line
   * into it, so what is written there never ends up inside it.
   */
  headSelector?: string
  /** The body changed: read it with the handle, when needed. */
  onInput?: () => void
  /** The editor is up, with its handle. */
  onReady?: (handle: RichTextEditorHandle) => void
}

// Minimal type surface for Squire — covers exactly the methods/events we
// drive. Full d.ts lives at squire-rte/dist/types/Editor.d.ts; we duplicate
// only what we use so the editor file is self-contained.
interface SquireInstance {
  destroy(): void
  setHTML(html: string): SquireInstance
  getHTML(withBookmark?: boolean): string
  insertHTML(html: string, isPaste?: boolean): SquireInstance
  insertPlainText(text: string, isPaste?: boolean): SquireInstance
  insertImage(src: string, attributes?: Record<string, string>): HTMLImageElement
  bold(): SquireInstance
  removeBold(): SquireInstance
  italic(): SquireInstance
  removeItalic(): SquireInstance
  underline(): SquireInstance
  removeUnderline(): SquireInstance
  strikethrough(): SquireInstance
  removeStrikethrough(): SquireInstance
  subscript(): SquireInstance
  removeSubscript(): SquireInstance
  superscript(): SquireInstance
  removeSuperscript(): SquireInstance
  makeLink(url: string, attributes?: Record<string, string>): SquireInstance
  removeLink(): SquireInstance
  setFontFace(face: string | null): SquireInstance
  setFontSize(size: string | null): SquireInstance
  setTextColor(color: string | null): SquireInstance
  setHighlightColor(color: string | null): SquireInstance
  makeUnorderedList(): SquireInstance
  makeOrderedList(): SquireInstance
  removeList(): SquireInstance
  setTextAlignment(alignment: string): SquireInstance
  increaseQuoteLevel(): SquireInstance
  decreaseQuoteLevel(): SquireInstance
  removeQuote(): SquireInstance
  forEachBlock(fn: (el: HTMLElement) => unknown, mutates: boolean): SquireInstance
  modifyBlocks(fn: (frag: DocumentFragment) => Node): SquireInstance
  removeAllFormatting(): SquireInstance
  modifyDocument(fn: () => void): SquireInstance
  saveUndoState(range?: Range): SquireInstance
  hasFormat(tag: string, attrs?: Record<string, string> | null): boolean
  getSelection(): Range
  setSelection(range: Range): SquireInstance
  getFontInfo(): Record<string, string | undefined>
  getPath(): string
  getRoot(): HTMLElement
  focus(): SquireInstance
  blur(): SquireInstance
  addEventListener(type: string, fn: (event: Event) => void): SquireInstance
  removeEventListener(type: string, fn?: (event: Event) => void): SquireInstance
  setKeyHandler(
    key: string,
    fn: ((squire: SquireInstance, event: KeyboardEvent, range: Range) => void) | null
  ): SquireInstance
  undo(): SquireInstance
  redo(): SquireInstance
  /** Which tag a block becomes when Enter splits it; a tag not here becomes the default block. */
  tagAfterSplit: Record<string, string>
}

interface SquireConfig {
  blockTag: string
  blockAttributes: Record<string, string> | null
  classNames: {
    color: string
    fontFamily: string
    fontSize: string
    highlight: string
  }
  sanitizeToDOMFragment: (html: string) => DocumentFragment
  willCutCopy: ((html: string) => string) | null
  toPlainText: ((html: string) => string) | null
  addLinks: boolean
  didError: (error: unknown) => void
}

type SquireConstructor = new (root: HTMLElement, config?: Partial<SquireConfig>) => SquireInstance

type SquireFrameWindow = Window & { Squire: SquireConstructor }

interface ToolbarButton {
  id: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  disabled: boolean
  action: () => void
  title: string
}

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const SAFE_LINK_PROTOCOL_PATTERN = /^(https?:\/\/|mailto:|tel:)/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB_COLOR_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i
const FONT_SIZE_INPUT_PATTERN = /^(\d+(?:\.\d+)?)(?:\s*(px|pt))?$/i
const CSS_PX_PER_PT = 4 / 3
const BASE_FONT_SIZE_PX = 14
const DEFAULT_CUSTOM_COLOR_PICKER_VALUE = '#000000'
const DEFAULT_CUSTOM_HIGHLIGHT_PICKER_VALUE = '#fef08a'

// `EDITOR_BODY_COLOR_HEX` matches the `color` declared on the iframe `body`
// in `MAIL_FRAME_BASELINE_CSS`. Clicking the toolbar's "Predefinito" entry
// applies this exact value (rather than `null`) so the new caret-wrapper
// span has higher specificity than any ancestor block — Squire's
// `setTextColor(null)` only unwraps marker spans we ourselves added in
// the same session, which is *not* enough when the colour the user wants
// to escape lives on an authored `<p style="color: …">` (signature,
// reply, paste). This mirrors what Gmail/Outlook do when you click their
// "Default text colour" entry: they wrap in `color: <body-default>`.
const EDITOR_BODY_COLOR_HEX = '#000000'
const DEFAULT_TEXT_COLOR_HEX = EDITOR_BODY_COLOR_HEX

// Highlight ("Nessuna evidenziazione"): clear via `transparent` rather
// than `null` for the same reason — `null` only strips our marker spans
// while leaving an ancestor `background-color` showing through.
const DEFAULT_HIGHLIGHT_VALUE = 'transparent'
const MIN_FONT_SIZE_PX = 2
const MAX_FONT_SIZE_PX = 98
const DEFAULT_EDITOR_LINE_HEIGHT = '1.5'
const ZERO_WIDTH_SPACE = '\u200B'

/** Chords the page itself answers in the editor: the clipboard and select all. */
const EDITOR_NATIVE_CHORD_CODES: ReadonlySet<string> = new Set(['KeyA', 'KeyC', 'KeyV', 'KeyX'])

// Squire's `setFontFace` / `setFontSize` / `setTextColor` / `setHighlightColor`
// each route through `changeFormat`, whose *remove* clause matches `<span>` by
// `class=<className>`. If we leave the four `classNames` empty (as marketing
// emails want for inline-only output), every set-method removes spans created
// by the OTHER three (because `class=""` matches `class=""`). The four
// properties end up mutually exclusive on a single text run.
//
// We give each property its own private marker class so Squire only unwraps
// its own kind, then strip those classes when we serialize the editor's HTML
// (see `stripEditorMarkerClassesInPlace`) so the wire format stays inline-
// style-only.
const STYLE_CLASS_NAMES = {
  color: '__mte-color',
  fontFamily: '__mte-font-family',
  fontSize: '__mte-font-size',
  highlight: '__mte-highlight'
} as const

const STYLE_MARKER_CLASS_VALUES: ReadonlySet<string> = new Set(Object.values(STYLE_CLASS_NAMES))

const FONT_SIZE_OPTIONS = [
  { value: '10px', label: '10' },
  { value: '12px', label: '12' },
  { value: '14px', label: '14' },
  { value: '16px', label: '16' },
  { value: '18px', label: '18' },
  { value: '20px', label: '20' },
  { value: '24px', label: '24' },
  { value: '32px', label: '32' }
] as const

const EDITOR_LINE_HEIGHT_OPTIONS = [
  { value: '1', label: '1.00' },
  { value: '1.25', label: '1.25' },
  { value: '1.5', label: '1.50' },
  { value: '1.75', label: '1.75' },
  { value: '2', label: '2.00' },
  { value: '2.5', label: '2.50' },
  { value: '3', label: '3.00' }
] as const

// An extension's own colours come first (see `ExtensionComposition`).
const TEXT_COLOR_OPTIONS: ReadonlyArray<TextColorOption> = [
  ...extensionShared.composition.textColors,
  { value: '#1f2937', label: 'Antracite' },
  { value: '#374151', label: 'Ardesia' },
  { value: '#6b7280', label: 'Grigio' },
  { value: '#9ca3af', label: 'Argento' },
  { value: '#f9fafb', label: 'Ghiaccio' },
  { value: '#b91c1c', label: 'Rosso' },
  { value: '#dc2626', label: 'Scarlatto' },
  { value: '#ea580c', label: 'Arancione' },
  { value: '#d97706', label: 'Ambra' },
  { value: '#ca8a04', label: 'Ocra' },
  { value: '#eab308', label: 'Giallo' },
  { value: '#84cc16', label: 'Lime' },
  { value: '#16a34a', label: 'Verde' },
  { value: '#059669', label: 'Smeraldo' },
  { value: '#0f766e', label: 'Petrolio' },
  { value: '#06b6d4', label: 'Ciano' },
  { value: '#0284c7', label: 'Azzurro' },
  { value: '#2563eb', label: 'Blu' },
  { value: '#4f46e5', label: 'Indaco' },
  { value: '#c026d3', label: 'Magenta' },
  { value: '#ec4899', label: 'Rosa' }
]

const TEXT_HIGHLIGHT_OPTIONS = [
  { value: '#fef08a', label: 'Giallo' },
  { value: '#fdba74', label: 'Pesca' },
  { value: '#fca5a5', label: 'Corallo' },
  { value: '#86efac', label: 'Verde' },
  { value: '#93c5fd', label: 'Azzurro' },
  { value: '#c4b5fd', label: 'Lilla' }
] as const

/** A command's name with the chord that runs it: "Grassetto (⌘B)", "Grassetto (Ctrl+B)". */
function withChord(label: string, key: string): string {
  const chord = navigator.platform.includes('Mac')
    ? `⌘${key.replace('Shift+', '⇧')}`
    : `Ctrl+${key}`

  return `${label} (${chord})`
}

/** Where the toolbar has room for everything; narrower, the rarer commands go under "Altro". */
const TOOLBAR_FULL_WIDTH = 900
/** Narrower still, it gives up its separators and the redo button, which ⌘⇧Z and "Altro" keep. */
const TOOLBAR_COMPACT_WIDTH = 580

function ToolbarSeparator(): React.JSX.Element {
  return <span aria-hidden className="bg-border mx-0.5 h-5 w-px shrink-0" />
}

const TABLE_PICKER_ROWS = 6
const TABLE_PICKER_COLUMNS = 8

/** The size of a new table, picked on a grid as Word and Outlook have it. */
function TableGridPicker({
  onPick
}: {
  onPick: (rows: number, columns: number) => void
}): React.JSX.Element {
  const [hover, setHover] = useState({ rows: 0, columns: 0 })

  return (
    <div className="p-1.5">
      <p className="text-muted-foreground mb-1.5 text-[11px]">
        {hover.rows > 0 ? `Tabella ${hover.columns} × ${hover.rows}` : 'Inserisci una tabella'}
      </p>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${TABLE_PICKER_COLUMNS}, 0.9rem)` }}
        onMouseLeave={() => setHover({ rows: 0, columns: 0 })}
      >
        {Array.from({ length: TABLE_PICKER_ROWS * TABLE_PICKER_COLUMNS }, (_, index) => {
          const rows = Math.floor(index / TABLE_PICKER_COLUMNS) + 1
          const columns = (index % TABLE_PICKER_COLUMNS) + 1
          const lit = rows <= hover.rows && columns <= hover.columns

          return (
            <button
              key={index}
              type="button"
              aria-label={`Tabella di ${columns} colonne e ${rows} righe`}
              onMouseEnter={() => setHover({ rows, columns })}
              onFocus={() => setHover({ rows, columns })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(rows, columns)}
              className={cn(
                'size-[0.9rem] rounded-[3px] border outline-none',
                lit ? 'border-primary/70 bg-selected' : 'border-border bg-background'
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

/** A table's cell as a message carries it: its border and spacing written on it — no mail client has the app's styles. */
const TABLE_CELL_STYLE =
  'border: 1px solid #c8ccd2; padding: 4px 8px; vertical-align: top; min-width: 2em;'

/** What a table takes from the line it is put in: the colour and face its text is written in. */
const TABLE_INHERITED_PROPERTIES = ['color', 'font-family', 'font-size', 'line-height'] as const

/** The top-level line of the body the caret is in, or null inside a list, a quote, a cell. */
function lineAtCaret(editor: SquireInstance): HTMLElement | null {
  const root = editor.getRoot()
  let node: Node | null = editor.getSelection().startContainer

  while (node && node.parentNode !== root) {
    node = node.parentNode
  }

  return node && isElementNode(node) && ['DIV', 'P'].includes(node.nodeName) ? node : null
}

function hasNoContent(element: Element): boolean {
  return (
    !(element.textContent ?? '').replace(ZERO_WIDTH_SPACE_PATTERN, '').replace(/\s/g, '').length &&
    !element.querySelector('img, table, hr')
  )
}

/**
 * Puts a table of `rows` × `columns` where the caret is, in the style of
 * its line, with a line like it below to go on writing, and the caret in
 * its first cell — a step ⌘Z takes back. In a list or a quote, where
 * there is no line of its own, it goes in as Squire inserts any HTML.
 */
function insertTable(editor: SquireInstance, rows: number, columns: number): void {
  const document = editor.getRoot().ownerDocument
  const line = lineAtCaret(editor)
  const table = document.createElement('table')
  table.setAttribute('style', 'border-collapse: collapse; width: 100%;')

  for (const property of TABLE_INHERITED_PROPERTIES) {
    const value = line?.style.getPropertyValue(property)

    if (value) {
      table.style.setProperty(property, value)
    }
  }

  const body = table.appendChild(document.createElement('tbody'))

  for (let row = 0; row < rows; row += 1) {
    const tr = body.appendChild(document.createElement('tr'))

    for (let column = 0; column < columns; column += 1) {
      const cell = tr.appendChild(document.createElement('td'))
      cell.setAttribute('style', TABLE_CELL_STYLE)
      cell.appendChild(document.createElement('br'))
    }
  }

  if (!line) {
    editor.insertHTML(`${table.outerHTML}<div><br></div>`)
    return
  }

  editor.saveUndoState()

  if (hasNoContent(line)) {
    // An empty line: the table takes its place above it, and it stays as the line after.
    line.before(table)
  } else {
    const after = line.cloneNode(false) as HTMLElement
    after.appendChild(document.createElement('br'))
    line.after(table, after)
  }

  const range = document.createRange()
  range.setStart(table.rows[0].cells[0], 0)
  range.collapse(true)
  editor.focus()
  editor.setSelection(range)
}

/**
 * Tab in a table: the next cell (`step` 1) or the one before (-1), its
 * text selected to be typed over, as in Word; past the last, a new row.
 * False when the caret is in no table.
 */
function moveBetweenCells(editor: SquireInstance, step: 1 | -1): boolean {
  const cell = cellAtCaret(editor)
  const table = cell?.closest('table')

  if (!cell || !table) {
    return false
  }

  const cells = Array.from(table.querySelectorAll('td, th')).filter(
    (candidate) => candidate.closest('table') === table
  )
  let target = cells[cells.indexOf(cell) + step] as HTMLTableCellElement | undefined

  if (!target && step === 1) {
    const last = table.rows[table.rows.length - 1]
    const added = last.cloneNode(false) as HTMLTableRowElement

    editor.saveUndoState()
    Array.from(last.cells).forEach((model) => added.appendChild(emptyCellLike(model)))
    last.after(added)
    target = added.cells[0]
  }

  if (target) {
    const range = table.ownerDocument.createRange()
    range.selectNodeContents(target)

    if (hasNoContent(target)) {
      range.collapse(true)
    }

    editor.setSelection(range)
  }

  return true
}

type TableOperation =
  | 'row-above'
  | 'row-below'
  | 'column-left'
  | 'column-right'
  | 'delete-row'
  | 'delete-column'
  | 'delete-table'

/** The table cell the caret is in, if any. */
function cellAtCaret(editor: SquireInstance): HTMLTableCellElement | null {
  const root = editor.getRoot()
  let node: Node | null = editor.getSelection().startContainer

  while (node && node !== root) {
    if (node.nodeName === 'TD' || node.nodeName === 'TH') {
      return node as HTMLTableCellElement
    }
    node = node.parentNode
  }

  return null
}

/** A cell like `model`, empty: the same borders and spacing. */
function emptyCellLike(model: HTMLTableCellElement): HTMLTableCellElement {
  const cell = model.cloneNode(false) as HTMLTableCellElement
  cell.removeAttribute('colspan')
  cell.removeAttribute('rowspan')
  cell.appendChild(model.ownerDocument.createElement('br'))
  return cell
}

/** Adds or takes away a row or column where the caret is, or the whole table: a step ⌘Z takes back. */
function changeTable(editor: SquireInstance, operation: TableOperation): void {
  const cell = cellAtCaret(editor)
  const row = cell?.parentElement as HTMLTableRowElement | null | undefined
  const table = cell?.closest('table')

  if (!cell || !row || !table) {
    return
  }

  const document = editor.getRoot().ownerDocument
  const rows = Array.from(table.rows)
  const column = cell.cellIndex
  let caret: Node | null = cell

  editor.saveUndoState()

  switch (operation) {
    case 'row-above':
    case 'row-below': {
      const added = row.cloneNode(false) as HTMLTableRowElement
      Array.from(row.cells).forEach((model) => added.appendChild(emptyCellLike(model)))
      row.parentElement?.insertBefore(added, operation === 'row-above' ? row : row.nextSibling)
      caret = added.cells[Math.min(column, added.cells.length - 1)] ?? added
      break
    }
    case 'column-left':
    case 'column-right':
      for (const each of rows) {
        const model = each.cells[Math.min(column, each.cells.length - 1)]

        if (model) {
          const added = emptyCellLike(model)
          each.insertBefore(added, operation === 'column-left' ? model : model.nextSibling)

          if (each === row) {
            caret = added
          }
        }
      }
      break
    case 'delete-row':
      caret = (row.nextElementSibling ?? row.previousElementSibling)?.firstElementChild ?? null
      row.remove()
      break
    case 'delete-column':
      for (const each of rows) {
        each.cells[Math.min(column, each.cells.length - 1)]?.remove()
      }
      caret = row.cells[Math.min(column, row.cells.length - 1)] ?? null
      break
    case 'delete-table':
      caret = table.nextElementSibling ?? table.previousElementSibling
      table.remove()
      break
  }

  // What is left without cells goes too: a table of no rows, rows of no cells.
  for (const each of Array.from(table.rows)) {
    if (each.cells.length === 0) {
      each.remove()
    }
  }

  if (table.isConnected && table.rows.length === 0) {
    caret = table.nextElementSibling ?? table.previousElementSibling
    table.remove()
  }

  editor.focus()

  if (caret?.isConnected) {
    const range = document.createRange()
    range.setStart(caret, 0)
    range.collapse(true)
    editor.setSelection(range)
  }
}

// Realm-agnostic node-type guards.
//
// The composer body lives inside a `srcdoc` iframe. The renderer's React
// code runs in the **outer** window. Every DOM node we receive from
// `editor.getRoot()`, `editor.getSelection()`, or any walk through
// `parentNode` belongs to the iframe's realm — and the iframe has its own
// `HTMLElement`/`Element`/`Text`/`DocumentFragment` constructors. A naive
// `node instanceof HTMLElement` (which is checked against the OUTER
// window's `HTMLElement`) silently returns `false` for every iframe node,
// so every guarded branch is skipped and our style readers report empty.
//
// `nodeType` is a numeric constant on the `Node` interface that's identical
// across realms, so we use it as the realm-safe identity check. We then
// cast to the appropriate type so the rest of the code can use the
// element/text APIs.
function isElementNode(node: Node | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1
}

function isTextNode(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3
}

function isDocumentFragmentNode(node: Node | null | undefined): node is DocumentFragment {
  return !!node && node.nodeType === 11
}

function clampRgbChannel(value: number): number {
  return Math.max(0, Math.min(255, value))
}

function normalizeColorToHex(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed === 'transparent') {
    return null
  }

  // `rgba(..., 0)` or `rgba(..., 0.0)` is fully transparent — treat as "no
  // colour" so the toolbar shows the default swatch instead of a phantom
  // black circle (which is what `normalizeColorToHex` would otherwise emit
  // by ignoring the alpha channel).
  if (/^rgba\([^)]+,\s*0(?:\.0+)?\s*\)$/.test(trimmed)) {
    return null
  }

  if (HEX_COLOR_PATTERN.test(trimmed)) {
    if (trimmed.length === 7) {
      return trimmed
    }
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
  }

  const rgbMatch = trimmed.match(RGB_COLOR_PATTERN)
  if (!rgbMatch) {
    return null
  }

  const red = clampRgbChannel(Number.parseInt(rgbMatch[1], 10))
  const green = clampRgbChannel(Number.parseInt(rgbMatch[2], 10))
  const blue = clampRgbChannel(Number.parseInt(rgbMatch[3], 10))

  return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`
}

// Resolve any CSS-spec colour string (named like `purple` / `slategray`,
// `hsl(...)` / `hwb(...)` / `lab(...)`, modern `color()` notation, the
// `transparent` keyword) into the toolbar's #rrggbb form.
//
// We delegate the parsing to the browser via a detached <canvas> 2D context
// — `fillStyle` accepts every CSS colour the rendering engine accepts, and
// reading it back returns either `#rrggbb` (opaque) or `rgba(..., a)`. No
// reflow is triggered (canvas isn't attached to the document). This is the
// same trick Gmail / Outlook use to show the right swatch for arbitrary
// authored colours that aren't in their preset palette.
function resolveCssColorToHex(
  value: string | null | undefined,
  document: Document | null | undefined
): string | null {
  if (!value) {
    return null
  }

  // Hex / rgb fast path — saves the canvas allocation when the input is
  // already in a form `normalizeColorToHex` understands.
  const direct = normalizeColorToHex(value)
  if (direct) {
    return direct
  }

  if (!document) {
    return null
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  // Sentinel-then-set: if the browser rejects `value`, `fillStyle` keeps the
  // sentinel; otherwise it normalises to a canonical form we can re-parse.
  const sentinel = '#0a0b0c'
  context.fillStyle = sentinel
  context.fillStyle = value
  const normalised = context.fillStyle
  if (typeof normalised !== 'string' || normalised === sentinel) {
    return null
  }

  return normalizeColorToHex(normalised)
}

function parseFontSizePx(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const match = value.trim().toLowerCase().match(FONT_SIZE_INPUT_PATTERN)
  if (!match) {
    return null
  }
  const parsed = Number.parseFloat(match[1])
  if (!Number.isFinite(parsed)) {
    return null
  }

  const unit = match[2] ?? 'px'
  return unit === 'pt' ? parsed * CSS_PX_PER_PT : parsed
}

function clampFontSizePx(value: number): number {
  return Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, value))
}

// Float-preserving font-size formatter for the toolbar input. We keep the
// underlying value precise (so `13pt` reads back as `17.33px`, not a rounded
// `17`) — otherwise a click on a quoted/forwarded line that authored its
// font-size in points would silently round, then re-applying the displayed
// size would drift the visual scale of the text.
function formatFontSizePxForDisplay(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toString()
}

function formatFontSizePxForCss(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `${rounded}px`
}

function normalizeLinkHref(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return `mailto:${trimmed}`
  }
  if (trimmed.toLowerCase().startsWith('www.')) {
    return `https://${trimmed}`
  }
  if (!URL_SCHEME_PATTERN.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}

function isSafeLinkHref(value: string): boolean {
  return SAFE_LINK_PROTOCOL_PATTERN.test(value)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Impossibile leggere il file: ${file.name}`))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Formato media non valido: ${file.name}`))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

type ContextualStyleProperty =
  'fontFamily' | 'fontSize' | 'color' | 'backgroundColor' | 'lineHeight' | 'textAlign'

// Strip the private style-marker classes from a serialized HTML string so the
// outgoing email body stays inline-style-only. We only touch SPAN classes that
// belong to our marker set — anything authored by the sender (gmail_quote,
// MsoNormal, marketing class hooks) is preserved verbatim.
function stripEditorMarkerClassesFromHtml(html: string, document: Document): string {
  if (!html.includes('__mte-')) {
    return html
  }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = html
  for (const span of wrapper.querySelectorAll<HTMLSpanElement>('span[class]')) {
    let mutated = false
    for (const cls of [...span.classList]) {
      if (STYLE_MARKER_CLASS_VALUES.has(cls)) {
        span.classList.remove(cls)
        mutated = true
      }
    }
    if (mutated && span.classList.length === 0) {
      span.removeAttribute('class')
    }
  }
  return wrapper.innerHTML
}

function walkUpForInlineStyle(
  node: Node,
  rootBoundary: Node,
  property: ContextualStyleProperty
): string | null {
  let current: Node | null = isElementNode(node) ? node : node.parentNode

  while (current && current !== rootBoundary) {
    if (isElementNode(current)) {
      const inline = current.style[property]
      if (inline) {
        return inline
      }
    }
    current = current.parentNode
  }

  return null
}

// Iterate the Text leaves that actually carry rendered characters inside the
// range. We deliberately skip:
//  - <br> and pure-ZWS text nodes (no style intent — an empty styled line
//    still inherits its parent block's font)
//  - inter-element whitespace text nodes (`\n` / `  ` between block siblings
//    introduced by prettified HTML on initial load) — their parent is
//    typically the editor body, which never carries the per-line styling, so
//    yielding them collapses the "common style across the selection" to
//    `null` even when every visible run agrees. This is exactly the bug the
//    user sees when selecting multiple lines that are visually identical.
function* iterateSelectionLeaves(range: Range): Iterable<Node> {
  if (range.collapsed) {
    return
  }
  const root = range.commonAncestorContainer
  const ownerDocument = root.ownerDocument
  if (!ownerDocument) {
    return
  }
  const treeRoot = isElementNode(root) || isDocumentFragmentNode(root) ? root : root.parentNode
  if (!treeRoot) {
    return
  }
  const walker = ownerDocument.createTreeWalker(treeRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!isTextNode(node)) {
        return NodeFilter.FILTER_SKIP
      }
      // Reject any text node that contributes no rendered glyph: ZWS-only
      // and whitespace-only (formatting whitespace between block siblings).
      if (node.data.replace(ZERO_WIDTH_SPACE_PATTERN, '').trim().length === 0) {
        return NodeFilter.FILTER_REJECT
      }
      return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })

  let current = walker.nextNode()
  while (current) {
    yield current
    current = walker.nextNode()
  }
}

// Resolve the inline style that would apply to the *next* character typed at
// the current selection. For a collapsed caret we walk up from the caret and
// adjacent leaves within the same block; for a range we require every covered
// leaf to inherit the same value (returning null on disagreement so the
// toolbar can show a neutral state instead of misreporting one side's value).
function readContextualStyleFromCursor(
  editor: SquireInstance,
  property: ContextualStyleProperty
): string | null {
  const root = editor.getRoot()
  const rootBoundary = root.parentNode ?? root
  const range = editor.getSelection()

  if (!range.collapsed) {
    let common: string | null | undefined
    let saw = false
    for (const leaf of iterateSelectionLeaves(range)) {
      saw = true
      const value = walkUpForInlineStyle(leaf, rootBoundary, property)
      if (common === undefined) {
        common = value
      } else if (common !== value) {
        return null
      }
    }
    return saw ? (common ?? null) : null
  }

  for (const anchor of findContextualStyleAnchors(editor)) {
    const value = walkUpForInlineStyle(anchor, rootBoundary, property)
    if (value) {
      return value
    }
  }

  return null
}

function readActiveFontFamily(editor: SquireInstance): string | null {
  const contextual = normalizeMailFontFamilyValue(
    readContextualStyleFromCursor(editor, 'fontFamily')
  )
  if (contextual) {
    return contextual
  }

  const fontInfo = editor.getFontInfo()
  return normalizeMailFontFamilyValue(fontInfo.fontFamily)
}

// Resolve the px-equivalent font-size at every leaf in the selection (or at
// the caret if collapsed) via `getComputedStyle`, so any unit the browser
// understands — px, pt, em, rem, %, the `small` / `medium` / `large` keywords,
// inherited values cascading from outer blocks — comes back as the actual
// rendered pixel size. This is what Gmail and Outlook do internally so the
// toolbar number always matches what the user visually perceives.
function readActiveFontSizePx(editor: SquireInstance): number {
  const root = editor.getRoot()
  const view = root.ownerDocument?.defaultView
  if (!view) {
    return BASE_FONT_SIZE_PX
  }

  const computeAt = (anchor: Node): number | null => {
    const element = isElementNode(anchor) ? anchor : anchor.parentElement
    if (!element) {
      return null
    }
    return parseFontSizePx(view.getComputedStyle(element).fontSize)
  }

  const range = editor.getSelection()

  if (!range.collapsed) {
    let common: number | undefined
    let saw = false
    for (const leaf of iterateSelectionLeaves(range)) {
      saw = true
      const value = computeAt(leaf)
      if (value === null) {
        continue
      }
      if (common === undefined) {
        common = value
      } else if (Math.abs(common - value) > 0.5) {
        // Mixed sizes inside the selection — the toolbar shows the editor
        // baseline so the user sees a neutral state instead of being told
        // one side's value applies to everything.
        return BASE_FONT_SIZE_PX
      }
    }
    if (saw && common !== undefined) {
      return clampFontSizePx(common)
    }
    return BASE_FONT_SIZE_PX
  }

  for (const anchor of findContextualStyleAnchors(editor)) {
    const value = computeAt(anchor)
    if (value !== null) {
      return clampFontSizePx(value)
    }
  }

  return BASE_FONT_SIZE_PX
}

// Read the active colour / background-colour as a hex swatch the toolbar can
// paint. Compared to a naïve `normalizeColorToHex` of the raw inline value
// this resolves named CSS colours (`purple`), modern colour functions
// (`hsl(...)`, `hwb(...)`, `lab(...)`, `oklch(...)`), and folds
// `transparent` / alpha-zero into "no colour" — so the swatch reflects the
// actually-rendered pixel even when the authored value isn't in our preset
// palette.
function readActiveColorAcrossSelection(
  editor: SquireInstance,
  property: 'color' | 'backgroundColor'
): string | null {
  const root = editor.getRoot()
  const ownerDocument = root.ownerDocument
  const rootBoundary = root.parentNode ?? root
  const range = editor.getSelection()

  const resolveAt = (anchor: Node): string | null =>
    resolveCssColorToHex(walkUpForInlineStyle(anchor, rootBoundary, property), ownerDocument)

  if (!range.collapsed) {
    let common: string | null | undefined
    let saw = false
    for (const leaf of iterateSelectionLeaves(range)) {
      saw = true
      const value = resolveAt(leaf)
      if (common === undefined) {
        common = value
      } else if (common !== value) {
        return null
      }
    }
    return saw ? (common ?? null) : null
  }

  for (const anchor of findContextualStyleAnchors(editor)) {
    const value = resolveAt(anchor)
    if (value) {
      return value
    }
  }

  return null
}

function readActiveColorHex(editor: SquireInstance): string | null {
  return readActiveColorAcrossSelection(editor, 'color')
}

function readActiveHighlightHex(editor: SquireInstance): string | null {
  return readActiveColorAcrossSelection(editor, 'backgroundColor')
}

const INLINE_TYPING_BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'LI',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TD',
  'TH'
])

function findClosestTypingBlock(root: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = isElementNode(node) ? node : node.parentNode

  while (current && current !== root) {
    if (isElementNode(current) && INLINE_TYPING_BLOCK_TAGS.has(current.tagName)) {
      return current
    }
    current = current.parentNode
  }

  return null
}

function getDeepestLastNode(node: Node): Node {
  let current = node
  while (current.lastChild) {
    current = current.lastChild
  }
  return current
}

function getDeepestFirstNode(node: Node): Node {
  let current = node
  while (current.firstChild) {
    current = current.firstChild
  }
  return current
}

function getPreviousNodeWithin(node: Node, boundary: Node): Node | null {
  let current: Node | null = node

  while (current && current !== boundary) {
    if (current.previousSibling) {
      return getDeepestLastNode(current.previousSibling)
    }
    current = current.parentNode
  }

  return null
}

function getNextNodeWithin(node: Node, boundary: Node): Node | null {
  let current: Node | null = node

  while (current && current !== boundary) {
    if (current.nextSibling) {
      return getDeepestFirstNode(current.nextSibling)
    }
    current = current.parentNode
  }

  return null
}

function getNodeBeforeRange(range: Range, boundary: Node): Node | null {
  const { startContainer, startOffset } = range

  if (isTextNode(startContainer)) {
    return startOffset > 0 ? startContainer : getPreviousNodeWithin(startContainer, boundary)
  }

  if (startContainer.childNodes.length > 0 && startOffset > 0) {
    return getDeepestLastNode(startContainer.childNodes[startOffset - 1])
  }

  return getPreviousNodeWithin(startContainer, boundary)
}

function getNodeAfterRange(range: Range, boundary: Node): Node | null {
  const { startContainer, startOffset } = range

  if (isTextNode(startContainer)) {
    return startOffset < startContainer.data.length
      ? startContainer
      : getNextNodeWithin(startContainer, boundary)
  }

  if (startContainer.childNodes.length > startOffset) {
    return getDeepestFirstNode(startContainer.childNodes[startOffset])
  }

  return getNextNodeWithin(startContainer, boundary)
}

function isUsefulContextualStyleAnchor(node: Node | null): node is Node {
  return Boolean(node && node.nodeName !== 'BR')
}

function pushUniqueNode(nodes: Node[], node: Node | null): void {
  if (node && !nodes.includes(node)) {
    nodes.push(node)
  }
}

function findContextualStyleAnchors(editor: SquireInstance): Node[] {
  const range = editor.getSelection()
  const root = editor.getRoot()
  const block = findClosestTypingBlock(root, range.startContainer)
  const boundary = block ?? root
  const anchors: Node[] = []

  if (range.startContainer !== block && range.startContainer !== root) {
    pushUniqueNode(anchors, range.startContainer)
  }

  const previous = getNodeBeforeRange(range, boundary)
  if (isUsefulContextualStyleAnchor(previous)) {
    pushUniqueNode(anchors, previous)
  }

  const next = getNodeAfterRange(range, boundary)
  if (isUsefulContextualStyleAnchor(next)) {
    pushUniqueNode(anchors, next)
  }

  pushUniqueNode(anchors, block)

  return anchors
}

function nodeHasAncestorTag(root: HTMLElement, node: Node, tags: ReadonlySet<string>): boolean {
  let current: Node | null = isElementNode(node) ? node : node.parentNode

  while (current && current !== root.parentNode) {
    if (isElementNode(current) && tags.has(current.tagName)) {
      return true
    }
    current = current.parentNode
  }

  return false
}

function nodeHasAncestorStyle(
  root: HTMLElement,
  node: Node,
  predicate: (element: HTMLElement) => boolean
): boolean {
  let current: Node | null = isElementNode(node) ? node : node.parentNode

  while (current && current !== root.parentNode) {
    if (isElementNode(current) && predicate(current)) {
      return true
    }
    current = current.parentNode
  }

  return false
}

function hasContextualFormat(
  editor: SquireInstance,
  tag: string,
  tags: readonly string[],
  stylePredicate?: (element: HTMLElement) => boolean
): boolean {
  const root = editor.getRoot()
  const tagSet = new Set(tags)
  const range = editor.getSelection()

  const passes = (anchor: Node): boolean => {
    if (nodeHasAncestorTag(root, anchor, tagSet)) {
      return true
    }
    return stylePredicate ? nodeHasAncestorStyle(root, anchor, stylePredicate) : false
  }

  if (!range.collapsed) {
    let saw = false
    for (const leaf of iterateSelectionLeaves(range)) {
      saw = true
      if (!passes(leaf)) {
        return false
      }
    }
    return saw
  }

  if (editor.hasFormat(tag)) {
    return true
  }

  return findContextualStyleAnchors(editor).some(passes)
}

function hasBoldWeight(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'bold' || normalized === 'bolder') {
    return true
  }

  const numeric = Number.parseInt(normalized, 10)
  return Number.isFinite(numeric) && numeric >= 600
}

function hasInlineBold(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'B', ['B', 'STRONG'], (element) =>
    hasBoldWeight(element.style.fontWeight)
  )
}

function hasInlineItalic(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'I', ['I', 'EM'], (element) => {
    const style = element.style.fontStyle.trim().toLowerCase()
    return style === 'italic' || style === 'oblique'
  })
}

function hasInlineUnderline(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'U', ['U'], (element) =>
    element.style.textDecoration.toLowerCase().includes('underline')
  )
}

function hasInlineStrike(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'S', ['S', 'STRIKE', 'DEL'], (element) =>
    element.style.textDecoration.toLowerCase().includes('line-through')
  )
}

function hasInlineSubscript(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'SUB', ['SUB'], (element) =>
    element.style.verticalAlign.trim().toLowerCase().includes('sub')
  )
}

function hasInlineSuperscript(editor: SquireInstance): boolean {
  return hasContextualFormat(editor, 'SUP', ['SUP'], (element) =>
    element.style.verticalAlign.trim().toLowerCase().includes('super')
  )
}

// Squire exposes a "/"-delimited element path from <body> to caret. Using
// regex segment-matching keeps this stable even when intermediate inline
// wrappers (B, I, FONT, SPAN…) appear in any order.
const HEADING_PATTERNS = {
  h1: /(?:^|>)H1(?:\.|>|$)/,
  h2: /(?:^|>)H2(?:\.|>|$)/,
  h3: /(?:^|>)H3(?:\.|>|$)/
} as const

const PATH_PATTERNS = {
  ul: /(?:^|>)UL(?:\.|>|$)/,
  ol: /(?:^|>)OL(?:\.|>|$)/,
  link: /(?:^|>)A(?:\.|>|$)/
} as const

function pathHasPattern(path: string, pattern: RegExp): boolean {
  return pattern.test(path)
}

/**
 * What a line the user types starts with: the default face and the
 * default line height, written on the block itself. The page under the
 * editor is a plain one (see `mail-html.ts`), so these have to live in the
 * message — which is also what makes them arrive as they look.
 */
function authoringBlockDeclarations(defaultFontFamily: string | null): Array<[string, string]> {
  return [
    ...(defaultFontFamily ? [['font-family', defaultFontFamily] as [string, string]] : []),
    ['line-height', DEFAULT_EDITOR_LINE_HEIGHT]
  ]
}

function authoringBlockStyle(defaultFontFamily: string | null): string {
  return authoringBlockDeclarations(defaultFontFamily)
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
}

function declaresProperty(style: string, property: string): boolean {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i').test(style)
}

// When the editor is initialized empty (or with the single empty line the
// composer uses as its sentinel for "blank message"), wrap the caret
// in a default block carrying the authoring defaults inline. For a
// non-empty initial value (reply, forward, signature) the leading authored
// blocks before the quoted message get whatever defaults they do not
// declare, so the user's text inherits them while the quoted body keeps its
// original styling — the Gmail behaviour.
function applyAuthoringDefaultsToInitialHtml(
  rawHtml: string,
  defaultFontFamily: string | null
): string {
  const declarations = authoringBlockDeclarations(defaultFontFamily)
  const trimmed = rawHtml.trim()

  if (!trimmed || /^<(p|div)>\s*(?:<br\s*\/?>)?\s*<\/\1>$/i.test(trimmed)) {
    return `<div style="${authoringBlockStyle(defaultFontFamily)}"><br></div>`
  }

  const document = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, 'text/html')
  const root = document.body.firstElementChild as HTMLElement | null

  if (!root) {
    return rawHtml
  }

  // Nothing to add: the input as it came, untouched by a serialisation round trip.
  return writeAuthoringDefaults(root, declarations) ? root.innerHTML : rawHtml
}

/**
 * Writes the authoring defaults onto the blocks the user writes in — every
 * top-level block above the quoted message — that do not declare them yet.
 * Returns whether it changed anything.
 */
function writeAuthoringDefaults(
  root: Element,
  declarations: ReadonlyArray<[string, string]>
): boolean {
  let changed = false

  for (const block of Array.from(root.children)) {
    if (block.tagName.toLowerCase() === 'blockquote' || block.classList.contains('gmail_quote')) {
      break
    }

    const style = block.getAttribute('style') ?? ''
    const additions = declarations.filter(([property]) => !declaresProperty(style, property))

    if (additions.length > 0) {
      const existing = style.trim().replace(/;+$/g, '')
      const added = additions.map(([property, value]) => `${property}: ${value}`).join('; ')
      block.setAttribute('style', existing ? `${existing}; ${added}` : added)
      changed = true
    }
  }

  return changed
}

interface UseSquireInstanceOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  /** What the body opens with: read once, when the editor is made. */
  initialHtml: string
  placeholder: string
  defaultFontFamily: string | null
  disabled: boolean
  /** The body's zoom, in percent: how it shows, never what it says. */
  zoom: number
  onInput: () => void
  /** Ctrl/⌘ + wheel over the body: the zoom is the host's. */
  onZoomWheel?: (deltaY: number) => void
  onFileDragEnter?: () => void
  /** ⌘K / Ctrl+K: a link on the selection. */
  onLinkShortcut: () => void
  headSelector?: string
}

interface SquireBootstrap {
  ready: boolean
  editor: SquireInstance | null
}

// Squire seeds empty inline elements with U+200B (zero-width space) on
// WebKit so the caret can land in them. We strip those out when sniffing for
// "is the body genuinely empty?" — otherwise the placeholder never appears.
const ZERO_WIDTH_SPACE_PATTERN = new RegExp(ZERO_WIDTH_SPACE, 'g')

// Toggle `data-empty` on the iframe's <html> element, NOT on body. Squire
// observes body with `subtree: true, attributes: true`, so any setAttribute
// on body fires its MutationObserver → `input` event. If `handleInput` then
// writes back to body's `data-empty`, we get an infinite microtask loop that
// freezes the renderer. Mutations on ancestors of the observed root are
// never reported, so writing to <html> is safe. The CSS rule reads the flag
// from <html> and the placeholder text from body via `attr()`.
function refreshEmptyState(body: HTMLElement): void {
  const empty =
    body.childElementCount <= 1 &&
    !body.querySelector('img, table, hr') &&
    !(body.textContent?.replace(ZERO_WIDTH_SPACE_PATTERN, '').trim() ?? '')
  const next = empty ? 'true' : 'false'
  const documentElement = body.ownerDocument.documentElement
  if (documentElement.getAttribute('data-empty') !== next) {
    documentElement.setAttribute('data-empty', next)
  }
}

/** The body as the editor hands it out: its own marker classes taken off. */
function readEditorHtml(editor: SquireInstance): string {
  return stripEditorMarkerClassesFromHtml(editor.getHTML(), editor.getRoot().ownerDocument)
}

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform)
/** Squire names its chords by the modifier the platform calls "command". */
const MOD = IS_MAC ? 'Meta-' : 'Ctrl-'

/**
 * Squire inside the editor's frame, as an uncontrolled editor — the way
 * Fastmail and Proton Mail, which built their composers on it, run it.
 *
 * The body is put in once, when the editor is made; from then on it is the
 * editor's, and the host reads it when it needs it (`getHTML`) and changes
 * it only by an explicit step (`setHTML`, `modify`, `insertHTML`). Feeding
 * the editor back the body it reported, as a controlled input does, raced
 * the keyboard: a value one keystroke old arrived after the next keystroke,
 * `setHTML` put it back and threw the caret to the top — the cursor that
 * "ran away" a few words into a message, the letters typed in reverse.
 */
function useSquireInstance(options: UseSquireInstanceOptions): SquireBootstrap {
  const { iframeRef, placeholder, defaultFontFamily, disabled, zoom } = options
  const [editor, setEditor] = useState<SquireInstance | null>(null)
  const initialHtmlRef = useRef(options.initialHtml)
  const disabledRef = useRef(disabled)
  const zoomRef = useRef(zoom)
  const callbacksRef = useRef(options)

  useEffect(() => {
    callbacksRef.current = options
    disabledRef.current = disabled
    zoomRef.current = zoom
  })

  // Bootstrap Squire inside the iframe. We use `srcdoc` with an embedded
  // `<script src="…">` tag pointing at the Squire bundle — the script is
  // parser-blocking, so by the time the iframe `load` event fires Squire
  // has already executed and `contentWindow.Squire` is the editor class.
  //
  // We can't inject Squire as an inline `<script>` (textContent) because the
  // renderer's CSP `script-src 'self'` blocks inline script execution. The
  // external-script form satisfies CSP because the asset is served from the
  // renderer's own origin.
  //
  // Once per frame: re-creating the iframe would wipe the editor and the
  // user's caret and undo.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    let disposed = false
    let created: SquireInstance | null = null
    const frameCleanupFns: Array<() => void> = []

    const handleLoad = (): void => {
      if (disposed) {
        return
      }

      const frameWindow = iframe.contentWindow as SquireFrameWindow | null
      const frameDocument = iframe.contentDocument

      if (!frameWindow || !frameDocument) {
        console.error('[mail-editor] iframe load fired but contentWindow/Document missing')
        return
      }

      const SquireClass = frameWindow.Squire
      if (typeof SquireClass !== 'function') {
        console.error('[mail-editor] Squire constructor not found in the frame:', squireScriptUrl)
        return
      }

      // Files dragged in from the desktop belong to the host (attachments),
      // never to the frame: left alone, Chromium would navigate the frame to
      // the file or Squire would inline a `file://` image nobody can see.
      // Text and HTML dragged within the body keep the default behaviour.
      const handleFileDrag = (event: DragEvent): void => {
        if (!event.dataTransfer?.types.includes('Files')) {
          return
        }

        event.preventDefault()

        if (event.type === 'dragenter') {
          callbacksRef.current.onFileDragEnter?.()
        } else if (event.type === 'dragover') {
          event.dataTransfer.dropEffect = callbacksRef.current.onFileDragEnter ? 'copy' : 'none'
        }
      }
      const fileDragEvents = ['dragenter', 'dragover', 'drop'] as const

      // Key events do not leave an iframe. What the editor leaves alone is
      // the host's — Escape, and the chords of its commands (send, attach,
      // the zoom…) — so it is handed to the frame element, from where it
      // travels through the host's DOM as if it had been pressed there.
      // Squire's own chords (bold, lists, undo…) arrive here already
      // handled, and the clipboard and select-all stay with the page.
      const forwardHostKey = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || event.isComposing) {
          return
        }

        const isEscape = event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey
        const isChord =
          (event.metaKey || event.ctrlKey || event.altKey) &&
          !EDITOR_NATIVE_CHORD_CODES.has(event.code)

        if (!isEscape && !isChord) {
          return
        }

        const forwarded = new KeyboardEvent('keydown', {
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
          bubbles: true,
          cancelable: true
        })
        iframe.dispatchEvent(forwarded)

        if (forwarded.defaultPrevented) {
          event.preventDefault()
        }
      }

      // Wheel events do not leave an iframe either: the zoom gesture over the
      // body — Ctrl/⌘ + wheel, a pinch on a trackpad — goes to the host.
      const handleWheel = (event: WheelEvent): void => {
        if (!(event.ctrlKey || event.metaKey) || !callbacksRef.current.onZoomWheel) {
          return
        }

        event.preventDefault()
        callbacksRef.current.onZoomWheel(event.deltaY)
      }

      frameDocument.addEventListener('keydown', forwardHostKey)
      frameDocument.addEventListener('wheel', handleWheel, { passive: false })
      fileDragEvents.forEach((type) => frameDocument.addEventListener(type, handleFileDrag, true))
      frameCleanupFns.push(() => {
        frameDocument.removeEventListener('keydown', forwardHostKey)
        frameDocument.removeEventListener('wheel', handleWheel)
        fileDragEvents.forEach((type) =>
          frameDocument.removeEventListener(type, handleFileDrag, true)
        )
      })

      let instance: SquireInstance
      try {
        instance = new SquireClass(frameDocument.body, {
          blockTag: 'div',
          // No attributes of our own on the blocks Squire makes: a line split
          // by Enter is then the line it came from — its colour, face, size —
          // as in every word processor, instead of a fresh block that dropped
          // them. The default face and line height are written onto the
          // lines as they appear (`writeAuthoringDefaults`).
          blockAttributes: null,
          // Distinct, private marker classes per property. Squire's
          // `_removeFormat` matches SPANs by `class=<className>`; if the four
          // classes were the same (or all empty) each set-method would unwrap
          // the spans created by the others, making font-family / font-size /
          // colour / highlight mutually exclusive on a single text run.
          // We strip these markers on output so the wire format stays
          // inline-style-only.
          classNames: {
            color: STYLE_CLASS_NAMES.color,
            fontFamily: STYLE_CLASS_NAMES.fontFamily,
            fontSize: STYLE_CLASS_NAMES.fontSize,
            highlight: STYLE_CLASS_NAMES.highlight
          },
          sanitizeToDOMFragment: (html: string) => sanitizeMailHtmlToFragment(html, frameDocument),
          willCutCopy: (html: string) => stripEditorMarkerClassesFromHtml(html, frameDocument),
          addLinks: true,
          didError: (error: unknown) => {
            console.warn('[mail-editor] squire error', error)
          }
        })
      } catch (error) {
        console.error('[mail-editor] Squire constructor threw', error)
        return
      }

      created = instance
      // A paragraph split by Enter stays a paragraph, with its style: Squire
      // turns any block but a list item into its default block otherwise,
      // and a signature's or a reply's lines are paragraphs.
      instance.tagAfterSplit.P = 'P'
      frameDocument.documentElement.style.zoom = String(zoomRef.current / 100)
      instance.setHTML(
        applyAuthoringDefaultsToInitialHtml(initialHtmlRef.current, defaultFontFamily)
      )

      instance.setKeyHandler(`${MOD}k`, (_squire, event) => {
        event.preventDefault()
        callbacksRef.current.onLinkShortcut()
      })

      // Tab moves between the cells of a table, indents a list item as Squire does, and
      // elsewhere puts a tab's worth of space at the caret: the keyboard never leaves the
      // message by itself.
      const keyHandlers = (
        instance as unknown as {
          _keyHandlers: Record<
            string,
            ((squire: SquireInstance, event: KeyboardEvent, range: Range) => void) | undefined
          >
        }
      )._keyHandlers
      const listTab = keyHandlers.Tab
      const listShiftTab = keyHandlers['Shift-Tab']
      const deleteBackward = keyHandlers.Backspace

      instance.setKeyHandler('Backspace', (squire, event, range) => {
        const head = callbacksRef.current.headSelector

        if (head && range.collapsed) {
          const root = squire.getRoot()
          let line: Node | null = range.startContainer

          while (line && line.parentNode !== root) {
            line = line.parentNode
          }

          if (line && isElementNode(line) && line.previousElementSibling?.matches(head)) {
            const before = root.ownerDocument.createRange()
            before.setStart(line, 0)
            before.setEnd(range.startContainer, range.startOffset)

            if (
              !before.toString().replace(ZERO_WIDTH_SPACE_PATTERN, '').length &&
              !before.cloneContents().querySelector?.('img, table')
            ) {
              event.preventDefault()
              return
            }
          }
        }

        deleteBackward?.(squire, event, range)
      })
      const INDENT = String.fromCharCode(0xa0).repeat(4)

      instance.setKeyHandler('Tab', (squire, event, range) => {
        if (moveBetweenCells(squire, 1)) {
          event.preventDefault()
          return
        }

        listTab?.(squire, event, range)

        if (!event.defaultPrevented) {
          event.preventDefault()
          squire.insertPlainText(INDENT, false)
        }
      })
      instance.setKeyHandler('Shift-Tab', (squire, event, range) => {
        if (moveBetweenCells(squire, -1)) {
          event.preventDefault()
          return
        }

        listShiftTab?.(squire, event, range)
        event.preventDefault()
      })

      const handleInput = (): void => {
        // A line made just now — Enter, a list, a paste — gets the default
        // face and line height here, in the live document, where the caret
        // stays put.
        writeAuthoringDefaults(frameDocument.body, authoringBlockDeclarations(defaultFontFamily))
        refreshEmptyState(frameDocument.body)
        callbacksRef.current.onInput()
      }

      instance.addEventListener('input', handleInput)
      refreshEmptyState(frameDocument.body)

      // Squire force-sets contenteditable=true at construction; only override
      // when `disabled` actually requires read-only — assigning the same
      // value still routes through setAttribute and would trip Squire's
      // MutationObserver chain (see `refreshEmptyState` for context).
      if (disabledRef.current && frameDocument.body.contentEditable !== 'false') {
        frameDocument.body.contentEditable = 'false'
      }

      setEditor(instance)
    }

    // Attach the listener BEFORE setting srcdoc so we never miss the load
    // event even if the browser parses srcdoc synchronously.
    iframe.addEventListener('load', handleLoad)

    iframe.srcdoc = buildMailFrameDocument({
      bodyHtml: '',
      editable: true,
      placeholder,
      scriptUrl: squireScriptUrl
    })

    return () => {
      disposed = true
      iframe.removeEventListener('load', handleLoad)
      while (frameCleanupFns.length > 0) {
        frameCleanupFns.pop()?.()
      }
      if (created) {
        try {
          created.destroy()
        } catch (error) {
          console.warn('[mail-editor] destroy failed', error)
        }
      }
      setEditor(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef])

  // The zoom shows the body larger or smaller; the message stays as written.
  useEffect(() => {
    const documentElement = editor?.getRoot().ownerDocument.documentElement

    if (documentElement) {
      documentElement.style.zoom = String(zoom / 100)
    }
  }, [editor, zoom])

  // Placeholder text is bonded to the iframe srcdoc once at construction
  // (see `buildMailFrameDocument` in mail-html.ts). We deliberately do NOT
  // mutate `body[data-placeholder]` post-mount: it would fire Squire's body
  // MutationObserver and chain through `input → handleInput → setAttribute
  // → MutationObserver → …` until the renderer freezes.

  // Toggle the caret editable state when the host flips `disabled`.
  useEffect(() => {
    if (!editor) {
      return
    }
    // Skip the assignment if the value is already correct — the IDL setter
    // calls setAttribute under the hood, and writing to body's attributes
    // fires Squire's MutationObserver and a stray `input` event.
    const root = editor.getRoot()
    const target = disabled ? 'false' : 'true'
    if (root.contentEditable !== target) {
      root.contentEditable = target
    }
  }, [disabled, editor])

  return { ready: editor !== null, editor }
}

type TextAlignment = 'left' | 'center' | 'right' | 'justify' | null

interface EditorActiveState {
  fontFamily: string | null
  fontSizePx: number
  // Cascade-resolved line-height ratio (px line-height ÷ px font-size) at
  // the caret. `null` when the cascade resolved to `normal` or we couldn't
  // measure. The toolbar compares this against the preset options to
  // decide which entry (if any) shows the checkmark — when nothing
  // matches, no option is checked, mirroring Gmail/Outlook.
  lineHeightRatio: number | null
  color: string | null
  highlight: string | null
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrike: boolean
  isSub: boolean
  isSup: boolean
  isUL: boolean
  isOL: boolean
  isLink: boolean
  isH1: boolean
  isH2: boolean
  isH3: boolean
  isQuote: boolean
  isInTable: boolean
  alignment: TextAlignment
  isFocused: boolean
  isEmpty: boolean
}

const INITIAL_ACTIVE_STATE: EditorActiveState = {
  fontFamily: null,
  fontSizePx: BASE_FONT_SIZE_PX,
  lineHeightRatio: null,
  color: null,
  highlight: null,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrike: false,
  isSub: false,
  isSup: false,
  isUL: false,
  isOL: false,
  isLink: false,
  isH1: false,
  isH2: false,
  isH3: false,
  isQuote: false,
  isInTable: false,
  alignment: null,
  isFocused: false,
  isEmpty: true
}

// Compute the line-height *ratio* (line-height-px ÷ font-size-px) at the
// caret using the cascade-resolved values from `getComputedStyle`. This
// uniformly handles unitless (`1.25`), pixel (`14px`), em (`1.5em`), and
// percent (`125%`) authoring — they all reduce to the same ratio
// representation.
//
// Returns `null` for the keyword `normal` (browser default) and for cases
// where we can't read either value: that becomes the "no preset selected"
// state in the toolbar dropdown, matching how Gmail/Outlook behave when
// the actual line-height isn't one of their presets.
function readActiveLineHeightRatio(editor: SquireInstance): number | null {
  const root = editor.getRoot()
  const view = root.ownerDocument?.defaultView
  if (!view) {
    return null
  }
  const range = editor.getSelection()
  const start = range.startContainer
  const target = isElementNode(start) ? start : start.parentElement
  if (!target) {
    return null
  }
  const cs = view.getComputedStyle(target)
  const lineHeightStr = cs.lineHeight
  if (!lineHeightStr || lineHeightStr === 'normal') {
    return null
  }
  // `getComputedStyle.lineHeight` returns the resolved value in pixels for
  // unitless / em / % authoring (e.g. `17.5px` for a 14-px font with
  // line-height 1.25), so we divide by the resolved font-size to get back
  // a unit-free ratio that's directly comparable to our preset values.
  const lineHeightPxMatch = lineHeightStr.match(/^([\d.]+)px$/i)
  if (!lineHeightPxMatch) {
    return null
  }
  const lineHeightPx = Number.parseFloat(lineHeightPxMatch[1])
  const fontSizePx = parseFontSizePx(cs.fontSize)
  if (!Number.isFinite(lineHeightPx) || !fontSizePx) {
    return null
  }
  return lineHeightPx / fontSizePx
}

function readActiveAlignment(editor: SquireInstance): TextAlignment {
  const root = editor.getRoot()
  const document = root.ownerDocument
  const selection = document.defaultView?.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return null
  }
  let node: Node | null = selection.getRangeAt(0).startContainer
  while (node && node !== root.parentNode) {
    if (isElementNode(node)) {
      const align = node.style.textAlign
      if (align === 'left' || align === 'center' || align === 'right' || align === 'justify') {
        return align
      }
      const legacy = node.getAttribute('align')?.toLowerCase()
      if (legacy === 'left' || legacy === 'center' || legacy === 'right' || legacy === 'justify') {
        return legacy
      }
    }
    node = node.parentNode
  }
  return null
}

const QUOTE_PATH_PATTERN = /(?:^|>)BLOCKQUOTE(?:\.|>|$)/
const TABLE_PATH_PATTERN = /(?:^|>)T[DH](?:\.|>|$)/

function useEditorActiveState(editor: SquireInstance | null): EditorActiveState {
  const [state, setState] = useState<EditorActiveState>(INITIAL_ACTIVE_STATE)

  useEffect(() => {
    if (!editor) {
      // No editor: keep state at initial. We deliberately do NOT setState
      // here — it would trigger a cascading render. The state is already
      // initialised correctly by `useState(INITIAL_ACTIVE_STATE)` above and
      // the editor only goes null on unmount in this app.
      return
    }

    const refresh = (): void => {
      const path = editor.getPath()
      const root = editor.getRoot()
      const isFocused = root.ownerDocument.activeElement === root
      // `data-empty` lives on <html>, not on body — see refreshEmptyState.
      const isEmpty = root.ownerDocument.documentElement.getAttribute('data-empty') === 'true'

      setState({
        fontFamily: readActiveFontFamily(editor),
        fontSizePx: readActiveFontSizePx(editor),
        lineHeightRatio: readActiveLineHeightRatio(editor),
        color: readActiveColorHex(editor),
        highlight: readActiveHighlightHex(editor),
        isBold: hasInlineBold(editor),
        isItalic: hasInlineItalic(editor),
        isUnderline: hasInlineUnderline(editor),
        isStrike: hasInlineStrike(editor),
        isSub: hasInlineSubscript(editor),
        isSup: hasInlineSuperscript(editor),
        isUL: pathHasPattern(path, PATH_PATTERNS.ul),
        isOL: pathHasPattern(path, PATH_PATTERNS.ol),
        isLink: pathHasPattern(path, PATH_PATTERNS.link),
        isQuote: pathHasPattern(path, QUOTE_PATH_PATTERN),
        isInTable: pathHasPattern(path, TABLE_PATH_PATTERN),
        alignment: readActiveAlignment(editor),
        isH1: pathHasPattern(path, HEADING_PATTERNS.h1),
        isH2: pathHasPattern(path, HEADING_PATTERNS.h2),
        isH3: pathHasPattern(path, HEADING_PATTERNS.h3),
        isFocused,
        isEmpty
      })
    }

    refresh()

    editor.addEventListener('pathChange', refresh)
    editor.addEventListener('cursor', refresh)
    editor.addEventListener('select', refresh)
    editor.addEventListener('input', refresh)
    editor.addEventListener('focus', refresh)
    editor.addEventListener('blur', refresh)

    return () => {
      editor.removeEventListener('pathChange', refresh)
      editor.removeEventListener('cursor', refresh)
      editor.removeEventListener('select', refresh)
      editor.removeEventListener('input', refresh)
      editor.removeEventListener('focus', refresh)
      editor.removeEventListener('blur', refresh)
    }
  }, [editor])

  return state
}

function setBlockHeading(editor: SquireInstance, level: 1 | 2 | 3, isActive: boolean): void {
  // Toggle: if the caret is already inside the requested heading, unwrap by
  // converting the block back to the editor's default <div>. Otherwise wrap
  // each touched block in <hN>. Squire's `modifyBlocks` runs the modifier
  // on the *cloned* fragment of selected blocks and then reinserts.
  const root = editor.getRoot()
  const document = root.ownerDocument
  const targetTag = isActive ? 'div' : `h${level}`

  editor.modifyBlocks((fragment) => {
    const wrapper = document.createDocumentFragment()
    const blocks = [...fragment.children]

    if (blocks.length === 0) {
      const heading = document.createElement(targetTag)
      heading.appendChild(document.createElement('br'))
      wrapper.appendChild(heading)
      return wrapper
    }

    for (const block of blocks) {
      const next = document.createElement(targetTag)
      while (block.firstChild) {
        next.appendChild(block.firstChild)
      }
      // Forward block-level inline styles so font-family / line-height set by
      // the user survive the toggle.
      const style = block.getAttribute('style')
      if (style) {
        next.setAttribute('style', style)
      }
      wrapper.appendChild(next)
    }

    return wrapper
  })
}

function applyLineHeight(editor: SquireInstance, lineHeight: string): void {
  editor.forEachBlock((block) => {
    block.style.lineHeight = lineHeight
  }, true)
}

export function RichTextEditor({
  handleRef,
  initialHtml,
  placeholder = "Scrivi il contenuto dell'email...",
  disabled = false,
  variant = 'boxed',
  expandToContainer,
  defaultFontFamily = MAIL_EDITOR_DEFAULT_FONT_FAMILY,
  zoom = READER_ZOOM_RESET,
  onZoomChange,
  onFileDragEnter,
  headSelector,
  onInput,
  onReady
}: RichTextEditorProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [fontFamilyMenuOpen, setFontFamilyMenuOpen] = useState(false)
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false)
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false)
  const [alignmentMenuOpen, setAlignmentMenuOpen] = useState(false)
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false)
  const [fontSizeInputFocused, setFontSizeInputFocused] = useState(false)
  const [fontSizeDraft, setFontSizeDraft] = useState('')
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
  const [toolbarWidth, setToolbarWidth] = useState(0)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const linkInputRef = useRef<HTMLInputElement | null>(null)
  const fontSizeInputRef = useRef<HTMLInputElement | null>(null)
  const customColorInputRef = useRef<HTMLInputElement | null>(null)
  const customHighlightInputRef = useRef<HTMLInputElement | null>(null)
  const inlineMediaInputRef = useRef<HTMLInputElement | null>(null)
  const fontSizeControlRef = useRef<HTMLDivElement | null>(null)
  // ⌘K reaches the link editor through here: it lives below, the frame above.
  const openLinkEditorRef = useRef<() => void>(() => undefined)

  const normalizedDefaultFontFamily = normalizeMailFontFamilyValue(defaultFontFamily)

  // The zoom builds on the one the previous wheel notch set, not on a stale render's.
  const zoomStateRef = useRef({ zoom, onZoomChange })
  const onReadyRef = useRef(onReady)
  const onInputRef = useRef(onInput)

  useEffect(() => {
    zoomStateRef.current = { zoom, onZoomChange }
    onReadyRef.current = onReady
    onInputRef.current = onInput
  }, [zoom, onZoomChange, onReady, onInput])

  const { editor } = useSquireInstance({
    iframeRef,
    initialHtml,
    placeholder,
    defaultFontFamily: normalizedDefaultFontFamily,
    disabled,
    zoom,
    onInput: () => onInputRef.current?.(),
    onZoomWheel: onZoomChange
      ? (deltaY) => {
          const state = zoomStateRef.current
          const next = wheelReaderZoom(state.zoom, deltaY)

          if (next !== state.zoom) {
            zoomStateRef.current = { ...state, zoom: next }
            state.onZoomChange?.(next)
          }
        }
      : undefined,
    onFileDragEnter,
    onLinkShortcut: () => openLinkEditorRef.current(),
    headSelector
  })

  const active = useEditorActiveState(editor)

  useEffect(() => {
    if (!editor) {
      return
    }

    const root = editor.getRoot()
    const document = root.ownerDocument

    const handle: RichTextEditorHandle = {
      getHTML: () => readEditorHtml(editor),
      setHTML: (html) => {
        editor.setHTML(applyAuthoringDefaultsToInitialHtml(html, normalizedDefaultFontFamily))
        refreshEmptyState(root)
        onInputRef.current?.()
      },
      modify: (change) => {
        // One step back with ⌘Z: the state before, kept; the change, made in
        // the live body where Squire sees it as any edit.
        editor.saveUndoState()
        change(root)
        refreshEmptyState(root)
      },
      insertHTML: (html) => {
        editor.focus()
        editor.insertHTML(html)
      },
      captureSelection: () => {
        const range = editor.getSelection()
        const text = range.toString().trim()

        if (range.collapsed || !text) {
          return null
        }

        const kept = range.cloneRange()
        let block: Node | null = range.startContainer

        while (block && block !== root && !['DIV', 'P'].includes(block.nodeName)) {
          block = block.parentNode
        }

        return {
          text,
          block: block && block !== root ? (block as Element) : null,
          // Squire writes over a selection it is given: the passage goes, the new one takes its place.
          replace: (html) => {
            if (!kept.startContainer.isConnected || kept.toString().trim() !== text) {
              return false
            }

            editor.setSelection(kept)
            editor.insertHTML(html)
            return true
          }
        }
      },
      focus: (where) => {
        const target = where?.(root)

        editor.focus()

        if (target) {
          const range = document.createRange()
          range.setStart(target, 0)
          range.collapse(true)
          editor.setSelection(range)
        }
      },
      select: (where) => {
        const target = where(root)

        if (target) {
          const range = document.createRange()
          range.setStart(target, 0)
          range.collapse(true)
          editor.setSelection(range)
        }
      }
    }

    if (handleRef) {
      handleRef.current = handle
    }

    onReadyRef.current?.(handle)

    return () => {
      if (handleRef?.current === handle) {
        handleRef.current = null
      }
    }
  }, [editor, handleRef, normalizedDefaultFontFamily])

  // The font-size input shows `active.fontSizePx` directly when not focused
  // and the user's `fontSizeDraft` while typing — see the input's `value`
  // binding below. We only seed the draft on focus / fill on option-pick,
  // so no cross-state sync effect is needed.

  // Line-height is applied only when the user explicitly picks a value from
  // the menu — never on first mount. Pushing it on mount would clobber the
  // line-height authored by senders inside reply / forward / paste content.

  // The toolbar keeps to one line: narrower than everything needs, the rarer commands go under
  // "Altro" instead of wrapping onto a second.
  useEffect(() => {
    const toolbar = toolbarRef.current

    if (!toolbar) {
      return
    }

    const observer = new ResizeObserver(([entry]) =>
      setToolbarWidth(Math.round(entry.contentRect.width))
    )
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  // Undo and redo, as far as the editor's history goes.
  useEffect(() => {
    if (!editor) {
      return
    }

    const onUndoState = (event: Event): void => {
      const detail = (event as CustomEvent<{ canUndo: boolean; canRedo: boolean }>).detail
      setUndoState({ canUndo: Boolean(detail?.canUndo), canRedo: Boolean(detail?.canRedo) })
    }

    editor.addEventListener('undoStateChange', onUndoState)
    return () => {
      editor.removeEventListener('undoStateChange', onUndoState)
    }
  }, [editor])

  useEffect(() => {
    if (!linkEditorOpen) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      linkInputRef.current?.focus()
      linkInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [linkEditorOpen])

  const runWithFocus = useCallback(
    (action: (editor: SquireInstance) => void): void => {
      if (!editor) {
        return
      }
      editor.focus()
      action(editor)
    },
    [editor]
  )

  const toggleBold = useCallback((): void => {
    runWithFocus((e) => (active.isBold ? e.removeBold() : e.bold()))
  }, [active.isBold, runWithFocus])

  const toggleItalic = useCallback((): void => {
    runWithFocus((e) => (active.isItalic ? e.removeItalic() : e.italic()))
  }, [active.isItalic, runWithFocus])

  const toggleUnderline = useCallback((): void => {
    runWithFocus((e) => (active.isUnderline ? e.removeUnderline() : e.underline()))
  }, [active.isUnderline, runWithFocus])

  const toggleStrike = useCallback((): void => {
    runWithFocus((e) => (active.isStrike ? e.removeStrikethrough() : e.strikethrough()))
  }, [active.isStrike, runWithFocus])

  const toggleSubscript = useCallback((): void => {
    runWithFocus((e) => (active.isSub ? e.removeSubscript() : e.subscript()))
  }, [active.isSub, runWithFocus])

  const toggleSuperscript = useCallback((): void => {
    runWithFocus((e) => (active.isSup ? e.removeSuperscript() : e.superscript()))
  }, [active.isSup, runWithFocus])

  // Heading menu action: pick a level (1/2/3) to wrap the selected blocks,
  // or `null` (= "Paragrafo") to peel off the heading and restore the default
  // <div> block. `setBlockHeading` already handles the cross-level switch
  // (e.g. H1 → H2) because `modifyBlocks` rewrites the wrapper element on
  // each block in-place, regardless of the original tag.
  const setHeadingLevel = useCallback(
    (level: 1 | 2 | 3 | null): void => {
      runWithFocus((e) => {
        const currentLevel = active.isH1 ? 1 : active.isH2 ? 2 : active.isH3 ? 3 : null
        if (level === null) {
          if (currentLevel !== null) {
            setBlockHeading(e, currentLevel, true)
          }
          return
        }
        if (level === currentLevel) {
          return
        }
        setBlockHeading(e, level, false)
      })
    },
    [active.isH1, active.isH2, active.isH3, runWithFocus]
  )

  /**
   * Squire's `makeOrderedList` / `makeUnorderedList` only build a list out of
   * plain blocks: pointed at a list of the other kind they leave it as it
   * was, so clicking "numerata" inside a bulleted list did nothing at all.
   * Every other editor treats the two buttons as a choice, so unwrap the
   * current list first and the second call then has plain blocks to work on.
   */
  const toggleBulletList = useCallback((): void => {
    runWithFocus((e) => {
      if (active.isUL) {
        e.removeList()
        return
      }

      if (active.isOL) {
        e.removeList()
      }

      e.makeUnorderedList()
    })
  }, [active.isOL, active.isUL, runWithFocus])

  const toggleOrderedList = useCallback((): void => {
    runWithFocus((e) => {
      if (active.isOL) {
        e.removeList()
        return
      }

      if (active.isUL) {
        e.removeList()
      }

      e.makeOrderedList()
    })
  }, [active.isOL, active.isUL, runWithFocus])

  const setAlignment = useCallback(
    (alignment: 'left' | 'center' | 'right' | 'justify'): void => {
      runWithFocus((e) => e.setTextAlignment(alignment))
    },
    [runWithFocus]
  )

  const increaseIndent = useCallback((): void => {
    runWithFocus((e) => e.increaseQuoteLevel())
  }, [runWithFocus])

  const decreaseIndent = useCallback((): void => {
    runWithFocus((e) => e.decreaseQuoteLevel())
  }, [runWithFocus])

  const toggleBlockquote = useCallback((): void => {
    runWithFocus((e) => (active.isQuote ? e.removeQuote() : e.increaseQuoteLevel()))
  }, [active.isQuote, runWithFocus])

  const setFontFamily = useCallback(
    (next: string): void => {
      runWithFocus((e) => e.setFontFace(next))
    },
    [runWithFocus]
  )

  const setFontSizePx = useCallback(
    (px: number): void => {
      const clamped = clampFontSizePx(px)
      runWithFocus((e) => e.setFontSize(formatFontSizePxForCss(clamped)))
    },
    [runWithFocus]
  )

  const setTextColor = useCallback(
    (color: string | null): void => {
      runWithFocus((e) => e.setTextColor(color))
    },
    [runWithFocus]
  )

  const setHighlightColor = useCallback(
    (color: string | null): void => {
      runWithFocus((e) => e.setHighlightColor(color))
    },
    [runWithFocus]
  )

  const openLinkEditor = useCallback((): void => {
    if (!editor || disabled) {
      return
    }
    // We can't ask Squire directly for current link href. Path tells us if
    // we're inside an <a>; if so we read it from the DOM via active selection.
    const document = editor.getRoot().ownerDocument
    const selection = document.defaultView?.getSelection()
    let initialHref = ''
    if (selection && selection.rangeCount > 0) {
      let node: Node | null = selection.getRangeAt(0).startContainer
      while (node) {
        if (isElementNode(node) && node.tagName === 'A') {
          initialHref = node.getAttribute('href') ?? ''
          break
        }
        node = node.parentNode
      }
    }
    setLinkDraft(initialHref)
    setLinkError(null)
    setLinkEditorOpen(true)
  }, [disabled, editor])

  useEffect(() => {
    openLinkEditorRef.current = openLinkEditor
  }, [openLinkEditor])

  const closeLinkEditor = useCallback((): void => {
    setLinkEditorOpen(false)
    setLinkError(null)
  }, [])

  const applyLink = useCallback((): void => {
    if (!editor) {
      return
    }
    const normalized = normalizeLinkHref(linkDraft)
    if (!normalized) {
      editor.focus()
      editor.removeLink()
      closeLinkEditor()
      return
    }
    if (!isSafeLinkHref(normalized)) {
      setLinkError('Protocollo link non supportato.')
      return
    }
    editor.focus()
    editor.makeLink(normalized, { target: '_blank', rel: 'noopener noreferrer' })
    closeLinkEditor()
  }, [closeLinkEditor, editor, linkDraft])

  const removeLink = useCallback((): void => {
    runWithFocus((e) => e.removeLink())
    closeLinkEditor()
  }, [closeLinkEditor, runWithFocus])

  const openMediaPicker = useCallback((): void => {
    if (!editor || disabled) {
      return
    }
    setMediaError(null)
    inlineMediaInputRef.current?.click()
  }, [disabled, editor])

  const insertPickedMedia = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!editor || !files) {
        return
      }
      const valid = [...files].filter(
        (file) =>
          file.type.toLowerCase().startsWith('image/') &&
          file.type.toLowerCase() !== 'image/svg+xml'
      )
      if (valid.length === 0) {
        setMediaError('Seleziona un file immagine valido (PNG, JPG, GIF, WEBP).')
        return
      }
      setMediaError(null)
      editor.focus()
      for (const file of valid) {
        try {
          const dataUrl = await fileToDataUrl(file)
          editor.insertImage(dataUrl, {
            alt: file.name || 'Immagine',
            title: file.name || 'Immagine'
          })
        } catch {
          setMediaError(`Impossibile inserire ${file.name}.`)
        }
      }
    },
    [editor]
  )

  // Squire fires `pasteImage` when the clipboard payload is image-only (no
  // accompanying HTML). Convert the file to a data-URL and insert it inline.
  useEffect(() => {
    if (!editor) {
      return
    }
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ clipboardData: DataTransfer | null }>).detail
      const files = detail?.clipboardData?.files
      if (!files || files.length === 0) {
        return
      }
      void insertPickedMedia(files)
    }
    editor.addEventListener('pasteImage', handler)
    return () => {
      editor.removeEventListener('pasteImage', handler)
    }
  }, [editor, insertPickedMedia])

  const clearFormatting = useCallback((): void => {
    runWithFocus((e) => e.removeAllFormatting())
    setMediaError(null)
    setLinkEditorOpen(false)
    setLinkError(null)
  }, [runWithFocus])

  const applyManualFontSize = useCallback((): void => {
    const parsed = parseFontSizePx(fontSizeDraft)
    const next = clampFontSizePx(parsed ?? active.fontSizePx)
    setFontSizePx(next)
    setFontSizeDraft(formatFontSizePxForDisplay(next))
  }, [active.fontSizePx, fontSizeDraft, setFontSizePx])

  const activeFontOption = findMailFontOption(active.fontFamily)
  const activeUnknownFontFamilyLabel = getDisplayMailFontFamily(active.fontFamily)
  const fontFamilyTriggerLabel =
    activeFontOption?.label || (active.fontFamily ? 'Altro...' : 'Font')

  // The toolbar is always rendered, even before Squire finishes booting —
  // this avoids a UX flash where buttons appear/disappear during init. The
  // `disabled` flag wraps each entry to no-op until the editor is ready.
  // Headings and text alignment now live in their own dropdowns (rendered
  // inline in the JSX) instead of expanding into 3+4 separate icon buttons,
  // which keeps the toolbar density coherent with how Gmail/Outlook group
  // related block-level commands.
  const editorPending = !editor
  const toolButtonDisabled = disabled || editorPending
  const inlineMarkButtons: ToolbarButton[] = [
    {
      id: 'bold',
      icon: Bold,
      active: active.isBold,
      disabled: toolButtonDisabled,
      action: toggleBold,
      title: withChord('Grassetto', 'B')
    },
    {
      id: 'italic',
      icon: Italic,
      active: active.isItalic,
      disabled: toolButtonDisabled,
      action: toggleItalic,
      title: withChord('Corsivo', 'I')
    },
    {
      id: 'underline',
      icon: UnderlineIcon,
      active: active.isUnderline,
      disabled: toolButtonDisabled,
      action: toggleUnderline,
      title: withChord('Sottolineato', 'U')
    },
    {
      id: 'strike',
      icon: Strikethrough,
      active: active.isStrike,
      disabled: toolButtonDisabled,
      action: toggleStrike,
      title: withChord('Barrato', 'Shift+7')
    },
    {
      id: 'subscript',
      icon: SubscriptIcon,
      active: active.isSub,
      disabled: toolButtonDisabled,
      action: toggleSubscript,
      title: 'Pedice'
    },
    {
      id: 'superscript',
      icon: SuperscriptIcon,
      active: active.isSup,
      disabled: toolButtonDisabled,
      action: toggleSuperscript,
      title: 'Apice'
    }
  ]
  const listButtons: ToolbarButton[] = [
    {
      id: 'bullet-list',
      icon: List,
      active: active.isUL,
      disabled: toolButtonDisabled,
      action: toggleBulletList,
      title: withChord('Elenco puntato', 'Shift+8')
    },
    {
      id: 'ordered-list',
      icon: ListOrdered,
      active: active.isOL,
      disabled: toolButtonDisabled,
      action: toggleOrderedList,
      title: withChord('Elenco numerato', 'Shift+9')
    }
  ]
  const indentQuoteButtons: ToolbarButton[] = [
    {
      id: 'outdent',
      icon: Outdent,
      active: false,
      disabled: toolButtonDisabled,
      action: decreaseIndent,
      title: withChord('Riduci rientro', '[')
    },
    {
      id: 'indent',
      icon: Indent,
      active: false,
      disabled: toolButtonDisabled,
      action: increaseIndent,
      title: withChord('Aumenta rientro', ']')
    },
    {
      id: 'blockquote',
      icon: Quote,
      active: active.isQuote,
      disabled: toolButtonDisabled,
      action: toggleBlockquote,
      title: 'Citazione'
    }
  ]

  // Pick the trigger icon that best summarises the cursor's heading / alignment
  // state, so the user sees at a glance what's currently applied without
  // opening the menu. Falls back to neutral icons for the unstyled default.
  const activeHeadingLevel = active.isH1 ? 1 : active.isH2 ? 2 : active.isH3 ? 3 : null
  const HeadingTriggerIcon =
    activeHeadingLevel === 1
      ? Heading1
      : activeHeadingLevel === 2
        ? Heading2
        : activeHeadingLevel === 3
          ? Heading3
          : Heading
  const AlignmentTriggerIcon =
    active.alignment === 'center'
      ? AlignCenter
      : active.alignment === 'right'
        ? AlignRight
        : active.alignment === 'justify'
          ? AlignJustify
          : AlignLeft
  // "Default" alignment in CSS resolves to `text-align: start` which renders
  // as left for LTR — so an explicit left alignment isn't visually distinct
  // from the default and shouldn't light up the trigger.
  const hasNonDefaultAlignment = active.alignment !== null && active.alignment !== 'left'
  const hasCustomTextColor = Boolean(active.color && active.color !== DEFAULT_TEXT_COLOR_HEX)
  const hasCustomHighlightColor = Boolean(active.highlight)

  // Room for every command, or the rarer ones under "Altro". Unmeasured yet: room.
  const wide = toolbarWidth === 0 || toolbarWidth >= TOOLBAR_FULL_WIDTH
  const compact = toolbarWidth > 0 && toolbarWidth < TOOLBAR_COMPACT_WIDTH

  const insertNewTable = (rows: number, columns: number): void => {
    setTableMenuOpen(false)
    setMoreMenuOpen(false)

    if (editor) {
      insertTable(editor, rows, columns)
    }
  }

  const tableOperation = (operation: TableOperation): void => {
    setTableMenuOpen(false)
    setMoreMenuOpen(false)

    if (editor) {
      changeTable(editor, operation)
    }
  }

  const tableMenuItems = (
    <>
      <TableGridPicker onPick={insertNewTable} />
      {active.isInTable && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('row-above')}>
            Inserisci una riga sopra
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('row-below')}>
            Inserisci una riga sotto
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('column-left')}>
            Inserisci una colonna a sinistra
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('column-right')}>
            Inserisci una colonna a destra
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('delete-row')}>
            Elimina la riga
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={() => tableOperation('delete-column')}>
            Elimina la colonna
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive-soft-foreground text-xs"
            onSelect={() => tableOperation('delete-table')}
          >
            Elimina la tabella
          </DropdownMenuItem>
        </>
      )}
    </>
  )

  // Under "Altro": what the toolbar has no room for, then what is always there.
  const moreMenuItems = (
    <>
      {!wide && (
        <>
          <DropdownMenuCheckboxItem
            checked={active.isStrike}
            className="gap-2 text-xs"
            onSelect={toggleStrike}
          >
            Barrato
          </DropdownMenuCheckboxItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">Stile del paragrafo</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[10rem] p-1">
              {[
                { level: null, label: 'Paragrafo' },
                { level: 1, label: 'Titolo 1' },
                { level: 2, label: 'Titolo 2' },
                { level: 3, label: 'Titolo 3' }
              ].map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.label}
                  checked={activeHeadingLevel === option.level}
                  className="text-xs"
                  onSelect={() => setHeadingLevel(option.level as 1 | 2 | 3 | null)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">Allineamento</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[10rem] p-1">
              {[
                { value: 'left', label: 'A sinistra' },
                { value: 'center', label: 'Al centro' },
                { value: 'right', label: 'A destra' },
                { value: 'justify', label: 'Giustificato' }
              ].map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={
                    option.value === 'left'
                      ? active.alignment === null || active.alignment === 'left'
                      : active.alignment === option.value
                  }
                  className="text-xs"
                  onSelect={() => setAlignment(option.value as Exclude<TextAlignment, null>)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className="text-xs" onSelect={decreaseIndent}>
            Riduci rientro
          </DropdownMenuItem>
          <DropdownMenuItem className="text-xs" onSelect={increaseIndent}>
            Aumenta rientro
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={active.isQuote}
            className="text-xs"
            onSelect={toggleBlockquote}
          >
            Citazione
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-xs" onSelect={openMediaPicker}>
            Inserisci un’immagine…
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">Tabella</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="p-1">{tableMenuItems}</DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className="text-xs"
            disabled={active.isEmpty}
            onSelect={clearFormatting}
          >
            Rimuovi formattazione
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      {compact && (
        <DropdownMenuItem
          className="text-xs"
          disabled={!undoState.canRedo}
          onSelect={() => runWithFocus((e) => e.redo())}
        >
          {withChord('Ripeti', 'Shift+Z')}
        </DropdownMenuItem>
      )}
      <DropdownMenuCheckboxItem
        checked={active.isSub}
        className="text-xs"
        onSelect={toggleSubscript}
      >
        {withChord('Pedice', 'Shift+5')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={active.isSup}
        className="text-xs"
        onSelect={toggleSuperscript}
      >
        {withChord('Apice', 'Shift+6')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs">Interlinea</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-[5rem] p-1">
          {EDITOR_LINE_HEIGHT_OPTIONS.map((option) => {
            const checked =
              active.lineHeightRatio !== null &&
              Math.abs(active.lineHeightRatio - Number(option.value)) < 0.02
            return (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={checked}
                className="text-xs"
                onSelect={() => {
                  if (editor) {
                    applyLineHeight(editor, option.value)
                    editor.focus()
                  }
                }}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        className="text-xs"
        onSelect={() => runWithFocus((e) => e.insertHTML('<hr><div><br></div>'))}
      >
        Linea orizzontale
      </DropdownMenuItem>
    </>
  )

  const renderToolbarButton = (
    key: string,
    title: string,
    button: React.JSX.Element
  ): React.JSX.Element => (
    <Tooltip key={key}>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )

  return (
    <div
      className={cn(
        'mail-editor overflow-hidden bg-transparent',
        variant === 'boxed' && 'border-border rounded-lg border',
        expandToContainer && 'flex h-full min-h-0 flex-col'
      )}
    >
      <div
        className={cn(
          'border-border flex items-start gap-2 border-b',
          variant === 'boxed' ? 'bg-card/80 p-2' : 'px-3 py-1.5'
        )}
      >
        <div
          ref={toolbarRef}
          className={cn(
            'flex min-w-0 flex-1 flex-wrap items-center',
            wide ? 'gap-1' : compact ? 'gap-0' : 'gap-0.5'
          )}
        >
          {renderToolbarButton(
            'undo',
            withChord('Annulla', 'Z'),
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => runWithFocus((e) => e.undo())}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Annulla"
              disabled={toolButtonDisabled || !undoState.canUndo}
            >
              <Undo2 className="size-4" />
            </Button>
          )}
          {!compact &&
            renderToolbarButton(
              'redo',
              withChord('Ripeti', 'Shift+Z'),
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => runWithFocus((e) => e.redo())}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="Ripeti"
                disabled={toolButtonDisabled || !undoState.canRedo}
              >
                <Redo2 className="size-4" />
              </Button>
            )}
          {!compact && <ToolbarSeparator />}
          {renderToolbarButton(
            'font-family',
            'Font',
            <PopoverPrimitive.Root
              open={fontFamilyMenuOpen}
              onOpenChange={setFontFamilyMenuOpen}
              modal={false}
            >
              <PopoverPrimitive.Trigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1 px-2 text-xs font-medium',
                    wide ? 'max-w-[10rem]' : 'max-w-[6.5rem]'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label="Font"
                  disabled={disabled || !editor}
                >
                  <span className="truncate">{fontFamilyTriggerLabel}</span>
                </Button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="border-border bg-popover text-popover-foreground shadow-background/65 z-50 max-h-80 min-w-[14rem] overflow-y-auto rounded-md border p-1 shadow-xl"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {active.fontFamily && !activeFontOption ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-xs opacity-50">
                      Altro: {activeUnknownFontFamilyLabel || 'font originale'}
                    </div>
                  ) : null}
                  {MAIL_FONT_OPTIONS.map((option) => {
                    const checked = areMailFontFamiliesEquivalent(active.fontFamily, option.value)
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={checked}
                        className={cn(
                          'focus:bg-secondary hover:bg-secondary flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors outline-none select-none',
                          checked && 'bg-secondary/60 font-semibold'
                        )}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setFontFamily(option.value)
                          setFontFamilyMenuOpen(false)
                        }}
                      >
                        <span style={{ fontFamily: option.value }}>{option.label}</span>
                      </button>
                    )
                  })}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}

          {renderToolbarButton(
            'font-size',
            'Dimensione testo',
            <PopoverPrimitive.Root
              open={fontSizeMenuOpen}
              onOpenChange={setFontSizeMenuOpen}
              modal={false}
            >
              <PopoverPrimitive.Anchor asChild>
                <div ref={fontSizeControlRef} className="relative w-16">
                  <Input
                    ref={fontSizeInputRef}
                    value={
                      fontSizeInputFocused
                        ? fontSizeDraft
                        : formatFontSizePxForDisplay(active.fontSizePx)
                    }
                    onChange={(event) => {
                      // Allow decimals so a forwarded line authored in pt
                      // (e.g. 13pt → 17.33px) round-trips visibly without
                      // silently rounding to a different visual size.
                      const next = event.target.value.replace(/[^0-9.]/g, '')
                      const dotIndex = next.indexOf('.')
                      const normalized =
                        dotIndex === -1
                          ? next
                          : next.slice(0, dotIndex + 1) +
                            next.slice(dotIndex + 1).replace(/\./g, '')
                      setFontSizeDraft(normalized)
                    }}
                    onFocus={() => {
                      setFontSizeInputFocused(true)
                      setFontSizeDraft(formatFontSizePxForDisplay(active.fontSizePx))
                      setFontSizeMenuOpen(true)
                    }}
                    onClick={() => {
                      if (!disabled && editor) {
                        setFontSizeMenuOpen(true)
                      }
                    }}
                    onBlur={() => {
                      applyManualFontSize()
                      setFontSizeInputFocused(false)
                      setFontSizeMenuOpen(false)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        applyManualFontSize()
                        setFontSizeMenuOpen(false)
                        return
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setFontSizeMenuOpen(true)
                        return
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        setFontSizeDraft(String(active.fontSizePx))
                        setFontSizeMenuOpen(false)
                        event.currentTarget.blur()
                      }
                    }}
                    className="hover:bg-secondary/60 h-8 w-full border-transparent bg-transparent px-1 text-center text-xs font-medium focus-visible:bg-transparent"
                    inputMode="numeric"
                    aria-label="Dimensione testo in pixel"
                    disabled={disabled || !editor}
                  />
                </div>
              </PopoverPrimitive.Anchor>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="border-border bg-popover text-popover-foreground shadow-background/65 z-50 w-16 min-w-0 overflow-hidden rounded-md border p-1 shadow-xl"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onInteractOutside={(event) => {
                    const target = event.target
                    if (target instanceof Node && fontSizeControlRef.current?.contains(target)) {
                      event.preventDefault()
                    }
                  }}
                >
                  {FONT_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={
                        Math.round(active.fontSizePx * 100) ===
                        Math.round((parseFontSizePx(option.value) ?? 0) * 100)
                      }
                      className="focus:bg-secondary hover:bg-secondary flex w-full cursor-default items-center justify-center rounded-sm px-0 py-1 text-xs font-medium transition-colors outline-none select-none"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        const px = parseFontSizePx(option.value) ?? BASE_FONT_SIZE_PX
                        setFontSizePx(px)
                        setFontSizeDraft(option.label)
                        setFontSizeMenuOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}

          {!compact && <ToolbarSeparator />}
          {inlineMarkButtons
            .filter(
              (button) =>
                ['bold', 'italic', 'underline'].includes(button.id) ||
                (wide && button.id === 'strike')
            )
            .map((button) => {
              const Icon = button.icon
              return renderToolbarButton(
                button.id,
                button.title,
                <Button
                  type="button"
                  variant={button.active ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8"
                  onClick={button.action}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label={button.title}
                  disabled={button.disabled || !editor}
                >
                  <Icon className="size-4" />
                </Button>
              )
            })}
          {renderToolbarButton(
            'text-color',
            'Colore testo',
            <PopoverPrimitive.Root
              open={colorMenuOpen}
              onOpenChange={setColorMenuOpen}
              modal={false}
            >
              <PopoverPrimitive.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex size-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    hasCustomTextColor
                      ? 'border-border bg-secondary text-secondary-foreground'
                      : 'hover:bg-secondary/60 border-transparent bg-transparent'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={disabled || !editor}
                  aria-label="Colore testo"
                >
                  <span
                    className="border-border/80 size-4 rounded-full border"
                    style={{
                      backgroundColor: active.color || 'hsl(var(--mail-editor-foreground))'
                    }}
                  />
                </button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="border-border bg-popover text-popover-foreground shadow-background/65 z-50 min-w-0 overflow-hidden rounded-md border p-2 shadow-xl"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="grid grid-cols-6 gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="border-input bg-input/45 relative size-7 rounded-full border"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setTextColor(EDITOR_BODY_COLOR_HEX)
                            setColorMenuOpen(false)
                          }}
                        >
                          <span className="bg-mail-editor-foreground absolute inset-1 rounded-full" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Predefinito</TooltipContent>
                    </Tooltip>
                    {TEXT_COLOR_OPTIONS.map((option) => (
                      <Tooltip key={option.value}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="border-border/80 size-7 rounded-full border"
                            style={{ backgroundColor: option.value }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setTextColor(option.value)
                              setColorMenuOpen(false)
                            }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">{option.label}</TooltipContent>
                      </Tooltip>
                    ))}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="border-input bg-input/45 hover:bg-secondary/60 inline-flex size-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => customColorInputRef.current?.click()}
                          disabled={disabled || !editor}
                        >
                          <Palette className="text-foreground/85 size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Colore personalizzato</TooltipContent>
                    </Tooltip>
                    <input
                      ref={customColorInputRef}
                      type="color"
                      value={active.color || DEFAULT_CUSTOM_COLOR_PICKER_VALUE}
                      onChange={(event) => {
                        setTextColor(event.target.value.toLowerCase())
                        setColorMenuOpen(false)
                      }}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}

          {renderToolbarButton(
            'text-highlight',
            'Colore sfondo testo',
            <PopoverPrimitive.Root
              open={highlightMenuOpen}
              onOpenChange={setHighlightMenuOpen}
              modal={false}
            >
              <PopoverPrimitive.Trigger asChild>
                <button
                  type="button"
                  className={cn(
                    'relative inline-flex size-8 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    hasCustomHighlightColor
                      ? 'border-border bg-secondary text-secondary-foreground'
                      : 'hover:bg-secondary/60 border-transparent bg-transparent'
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  disabled={disabled || !editor}
                  aria-label="Colore sfondo testo"
                >
                  <Highlighter className="text-foreground/85 size-4" />
                  <span
                    className="border-border/80 absolute right-1 bottom-1 left-1 h-1 rounded-full border"
                    style={{ backgroundColor: active.highlight || 'transparent' }}
                  />
                </button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  side="bottom"
                  align="start"
                  sideOffset={4}
                  className="border-border bg-popover text-popover-foreground shadow-background/65 z-50 min-w-0 overflow-hidden rounded-md border p-2 shadow-xl"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="grid grid-cols-4 gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="border-input bg-input/45 relative size-7 rounded-full border"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setHighlightColor(DEFAULT_HIGHLIGHT_VALUE)
                            setHighlightMenuOpen(false)
                          }}
                        >
                          <span className="border-border/80 bg-background absolute inset-1 rounded-full border" />
                          <span className="bg-destructive absolute top-3 left-1 h-0.5 w-5 rotate-45 rounded-full" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Nessuna evidenziazione</TooltipContent>
                    </Tooltip>
                    {TEXT_HIGHLIGHT_OPTIONS.map((option) => (
                      <Tooltip key={option.value}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="border-border/80 size-7 rounded-full border"
                            style={{ backgroundColor: option.value }}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setHighlightColor(option.value)
                              setHighlightMenuOpen(false)
                            }}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top">{option.label}</TooltipContent>
                      </Tooltip>
                    ))}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="border-input bg-input/45 hover:bg-secondary/60 inline-flex size-7 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => customHighlightInputRef.current?.click()}
                          disabled={disabled || !editor}
                        >
                          <Palette className="text-foreground/85 size-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Colore personalizzato</TooltipContent>
                    </Tooltip>
                    <input
                      ref={customHighlightInputRef}
                      type="color"
                      value={active.highlight || DEFAULT_CUSTOM_HIGHLIGHT_PICKER_VALUE}
                      onChange={(event) => {
                        setHighlightColor(event.target.value.toLowerCase())
                        setHighlightMenuOpen(false)
                      }}
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                  </div>
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          )}

          {!compact && <ToolbarSeparator />}
          {wide &&
            renderToolbarButton(
              'heading',
              'Titoli',
              <DropdownMenu open={headingMenuOpen} onOpenChange={setHeadingMenuOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={headingMenuOpen || activeHeadingLevel !== null ? 'secondary' : 'ghost'}
                    size="icon"
                    className="size-8"
                    onMouseDown={(event) => event.preventDefault()}
                    aria-label="Titoli"
                    disabled={disabled || !editor}
                  >
                    <HeadingTriggerIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-[10rem] p-1"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {[
                    { level: null, label: 'Paragrafo', icon: Pilcrow },
                    { level: 1, label: 'Titolo 1', icon: Heading1 },
                    { level: 2, label: 'Titolo 2', icon: Heading2 },
                    { level: 3, label: 'Titolo 3', icon: Heading3 }
                  ].map((option) => {
                    const Icon = option.icon
                    return (
                      <DropdownMenuCheckboxItem
                        key={option.label}
                        checked={activeHeadingLevel === option.level}
                        className="gap-2 text-xs"
                        onSelect={(event) => {
                          event.preventDefault()
                          setHeadingLevel(option.level as 1 | 2 | 3 | null)
                          setHeadingMenuOpen(false)
                        }}
                      >
                        <Icon className="size-4" />
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          {listButtons.map((button) => {
            const Icon = button.icon
            return renderToolbarButton(
              button.id,
              button.title,
              <Button
                type="button"
                variant={button.active ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                onClick={button.action}
                onMouseDown={(event) => event.preventDefault()}
                aria-label={button.title}
                disabled={button.disabled || !editor}
              >
                <Icon className="size-4" />
              </Button>
            )
          })}

          {(wide ? indentQuoteButtons : []).map((button) => {
            const Icon = button.icon
            return renderToolbarButton(
              button.id,
              button.title,
              <Button
                type="button"
                variant={button.active ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                onClick={button.action}
                onMouseDown={(event) => event.preventDefault()}
                aria-label={button.title}
                disabled={button.disabled || !editor}
              >
                <Icon className="size-4" />
              </Button>
            )
          })}
          {wide &&
            renderToolbarButton(
              'alignment',
              'Allineamento',
              <DropdownMenu
                open={alignmentMenuOpen}
                onOpenChange={setAlignmentMenuOpen}
                modal={false}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={alignmentMenuOpen || hasNonDefaultAlignment ? 'secondary' : 'ghost'}
                    size="icon"
                    className="size-8"
                    onMouseDown={(event) => event.preventDefault()}
                    aria-label="Allineamento"
                    disabled={disabled || !editor}
                  >
                    <AlignmentTriggerIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-[11rem] p-1"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {[
                    { value: 'left', label: 'Allinea a sinistra', icon: AlignLeft },
                    { value: 'center', label: 'Centra', icon: AlignCenter },
                    { value: 'right', label: 'Allinea a destra', icon: AlignRight },
                    { value: 'justify', label: 'Giustifica', icon: AlignJustify }
                  ].map((option) => {
                    const Icon = option.icon
                    return (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={
                          option.value === 'left'
                            ? active.alignment === null || active.alignment === 'left'
                            : active.alignment === option.value
                        }
                        className="gap-2 text-xs"
                        onSelect={(event) => {
                          event.preventDefault()
                          setAlignment(option.value as Exclude<TextAlignment, null>)
                          setAlignmentMenuOpen(false)
                        }}
                      >
                        <Icon className="size-4" />
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          {!compact && <ToolbarSeparator />}
          {renderToolbarButton(
            'link',
            withChord('Link', 'K'),
            <Button
              type="button"
              variant={active.isLink ? 'secondary' : 'ghost'}
              size="icon"
              className="size-8"
              onClick={openLinkEditor}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Link"
              disabled={disabled || !editor}
            >
              <Link2 className="size-4" />
            </Button>
          )}

          {wide &&
            renderToolbarButton(
              'inline-media',
              'Inserisci media nel contenuto',
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={openMediaPicker}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="Inserisci media nel contenuto"
                disabled={disabled || !editor}
              >
                <ImagePlus className="size-4" />
              </Button>
            )}
          {wide &&
            renderToolbarButton(
              'table',
              'Tabella',
              <DropdownMenu open={tableMenuOpen} onOpenChange={setTableMenuOpen} modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={tableMenuOpen || active.isInTable ? 'secondary' : 'ghost'}
                    size="icon"
                    className="size-8"
                    onMouseDown={(event) => event.preventDefault()}
                    aria-label="Tabella"
                    disabled={toolButtonDisabled}
                  >
                    <TableIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="p-1"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {tableMenuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          {wide &&
            renderToolbarButton(
              'clear-formatting',
              'Rimuovi formattazione',
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={clearFormatting}
                onMouseDown={(event) => event.preventDefault()}
                aria-label="Rimuovi formattazione"
                disabled={disabled || !editor || active.isEmpty}
              >
                <RemoveFormatting className="size-4" />
              </Button>
            )}
          {renderToolbarButton(
            'more',
            'Altro',
            <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen} modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={moreMenuOpen ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-8"
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label="Altri comandi di formattazione"
                  disabled={toolButtonDisabled}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-[13rem] p-1 text-xs"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                {moreMenuItems}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <input
        ref={inlineMediaInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void insertPickedMedia(event.currentTarget.files)
          event.currentTarget.value = ''
        }}
      />

      {mediaError && (
        <div className="text-destructive border-border/60 bg-card/50 border-t px-3 py-2 text-xs">
          {mediaError}
        </div>
      )}

      {linkEditorOpen && (
        <div className="border-border bg-card/70 flex flex-wrap items-center gap-2 border-b p-2">
          <Input
            ref={linkInputRef}
            value={linkDraft}
            onChange={(event) => {
              setLinkDraft(event.target.value)
              if (linkError) {
                setLinkError(null)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyLink()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                closeLinkEditor()
              }
            }}
            placeholder="https://esempio.com o nome@dominio.com"
            disabled={disabled}
            className="h-9 min-w-52 grow"
          />
          <Button
            type="button"
            size="sm"
            onMouseDown={(event) => event.preventDefault()}
            onClick={applyLink}
            disabled={disabled}
          >
            Applica
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={removeLink}
            disabled={disabled || !active.isLink}
          >
            Rimuovi link
          </Button>
          {linkError && <p className="text-destructive w-full text-xs">{linkError}</p>}
        </div>
      )}

      <div
        className={cn(
          'mail-editor-content bg-mail-editor-surface relative transition-[height] duration-150',
          expandToContainer ? 'min-h-0 flex-1' : 'h-[350px]'
        )}
      >
        <iframe
          ref={iframeRef}
          title="Editor email"
          className="block size-full border-0 bg-transparent"
          // We intentionally do not sandbox the iframe: Squire's runtime needs
          // to execute inside the iframe (selection / clipboard / mutation
          // observer all reference its own window). The iframe document is
          // built locally — every untrusted HTML fragment passes through
          // DOMPurify before reaching the DOM, mirroring the viewer policy.
        />
      </div>
    </div>
  )
}
