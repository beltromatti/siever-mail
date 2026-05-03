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
  Maximize2,
  Minimize2,
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

import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenuCheckboxItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Input } from '@renderer/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { htmlToPlainText } from '@renderer/lib/email'
import { buildMailFrameDocument, sanitizeMailHtmlToFragment } from '@renderer/lib/mail-html'
import {
  areMailFontFamiliesEquivalent,
  findMailFontOption,
  getDisplayMailFontFamily,
  getPrimaryMailFontFamily,
  MAIL_EDITOR_DEFAULT_FONT_FAMILY,
  MAIL_FONT_OPTIONS,
  normalizeMailFontFamilyValue
} from '@renderer/lib/mail-fonts'
import { cn } from '@renderer/lib/utils'

interface RichTextEditorProps {
  value: string
  placeholder?: string
  disabled?: boolean
  expanded?: boolean
  showExpandToggle?: boolean
  expandToContainer?: boolean
  defaultFontFamily?: string
  onExpandedChange?: (expanded: boolean) => void
  onChange: (html: string, text: string) => void
}

// Minimal type surface for Squire — covers exactly the methods/events we
// drive. Full d.ts lives at squire-rte/dist/types/Editor.d.ts; we duplicate
// only what we use so the editor file is self-contained.
interface SquireInstance {
  destroy(): void
  setHTML(html: string): SquireInstance
  getHTML(withBookmark?: boolean): string
  insertHTML(html: string, isPaste?: boolean): SquireInstance
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
const EDITOR_BODY_COLOR_HEX = '#1f2328'
const DEFAULT_TEXT_COLOR_HEX = EDITOR_BODY_COLOR_HEX

// Highlight ("Nessuna evidenziazione"): clear via `transparent` rather
// than `null` for the same reason — `null` only strips our marker spans
// while leaving an ancestor `background-color` showing through.
const DEFAULT_HIGHLIGHT_VALUE = 'transparent'
const MIN_FONT_SIZE_PX = 2
const MAX_FONT_SIZE_PX = 98
const DEFAULT_EDITOR_LINE_HEIGHT = '1.5'
const ZERO_WIDTH_SPACE = '\u200B'

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

const TEXT_COLOR_OPTIONS = [
  { value: '#7030a0', label: 'Viola SIEVER' },
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
] as const

const TEXT_HIGHLIGHT_OPTIONS = [
  { value: '#fef08a', label: 'Giallo' },
  { value: '#fdba74', label: 'Pesca' },
  { value: '#fca5a5', label: 'Corallo' },
  { value: '#86efac', label: 'Verde' },
  { value: '#93c5fd', label: 'Azzurro' },
  { value: '#c4b5fd', label: 'Lilla' }
] as const

function LineSpacingIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M11 6h8" />
      <path d="M11 12h8" />
      <path d="M11 18h8" />
      <path d="M5 4v16" />
      <path d="m3 6 2-2 2 2" />
      <path d="m3 18 2 2 2-2" />
    </svg>
  )
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
  | 'fontFamily'
  | 'fontSize'
  | 'color'
  | 'backgroundColor'
  | 'lineHeight'
  | 'textAlign'

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

interface InlineTypingFormat {
  fontFamily: string | null
  fontSizePx: number
  color: string | null
  highlight: string | null
  lineHeight: string | null
  textAlign: string | null
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrike: boolean
  isSub: boolean
  isSup: boolean
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

// The typing snapshot preserves *raw* CSS color strings (e.g. `purple`,
// `rgba(...)`, `#800080`) — the toolbar uses a hex-normalised view, but for
// re-emitting the format on a fresh empty block we need to replay whatever
// the imported content authored, including named colours that
// `normalizeColorToHex` (which only understands hex/rgb) would reject as
// `null` and silently drop on the next line.
function readInlineTypingFormat(editor: SquireInstance): InlineTypingFormat {
  return {
    fontFamily: readActiveFontFamily(editor),
    fontSizePx: readActiveFontSizePx(editor),
    color: readContextualStyleFromCursor(editor, 'color'),
    highlight: readContextualStyleFromCursor(editor, 'backgroundColor'),
    lineHeight: readContextualStyleFromCursor(editor, 'lineHeight'),
    textAlign: readContextualStyleFromCursor(editor, 'textAlign') || readActiveAlignment(editor),
    isBold: hasInlineBold(editor),
    isItalic: hasInlineItalic(editor),
    isUnderline: hasInlineUnderline(editor),
    isStrike: hasInlineStrike(editor),
    isSub: hasInlineSubscript(editor),
    isSup: hasInlineSuperscript(editor)
  }
}

function hasInlineTypingFormat(format: InlineTypingFormat): boolean {
  return (
    Boolean(format.fontFamily) ||
    format.fontSizePx !== BASE_FONT_SIZE_PX ||
    Boolean(format.color) ||
    Boolean(format.highlight) ||
    Boolean(format.lineHeight) ||
    Boolean(format.textAlign) ||
    format.isBold ||
    format.isItalic ||
    format.isUnderline ||
    format.isStrike ||
    format.isSub ||
    format.isSup
  )
}

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

function isEmptyTypingBlock(block: HTMLElement): boolean {
  const text = block.textContent?.replace(ZERO_WIDTH_SPACE_PATTERN, '').trim() ?? ''
  return !text && !block.querySelector('img, table')
}

function wrapNode(
  document: Document,
  child: Node,
  tagName: string,
  style?: Partial<CSSStyleDeclaration>
): HTMLElement {
  const element = document.createElement(tagName)
  if (style) {
    Object.assign(element.style, style)
  }
  element.appendChild(child)
  return element
}

// Wrap an arbitrary leaf node (a text node, the user's typed character, or a
// ZWS placeholder for the caret) in the inline tags + style span demanded by
// the typing snapshot. Used by both the typing-into-empty-block path and the
// post-Enter seeding path so the two flows produce identical structure.
function wrapLeafWithTypingFormat(
  document: Document,
  leaf: Node,
  format: InlineTypingFormat
): Node {
  let node: Node = leaf

  if (format.isSub) {
    node = wrapNode(document, node, 'sub')
  } else if (format.isSup) {
    node = wrapNode(document, node, 'sup')
  }
  if (format.isStrike) {
    node = wrapNode(document, node, 's')
  }
  if (format.isUnderline) {
    node = wrapNode(document, node, 'u')
  }
  if (format.isItalic) {
    node = wrapNode(document, node, 'i')
  }
  if (format.isBold) {
    node = wrapNode(document, node, 'b')
  }

  const inlineStyle: Partial<CSSStyleDeclaration> = {}
  if (format.fontFamily) {
    inlineStyle.fontFamily = format.fontFamily
  }
  if (format.fontSizePx !== BASE_FONT_SIZE_PX) {
    inlineStyle.fontSize = formatFontSizePxForCss(format.fontSizePx)
  }
  if (format.color) {
    inlineStyle.color = format.color
  }
  if (format.highlight) {
    inlineStyle.backgroundColor = format.highlight
  }

  if (Object.keys(inlineStyle).length > 0) {
    node = wrapNode(document, node, 'span', inlineStyle)
  }

  return node
}

function applyBlockTypingFormat(block: HTMLElement, format: InlineTypingFormat): void {
  if (format.lineHeight) {
    block.style.lineHeight = format.lineHeight
  }
  if (
    format.textAlign === 'left' ||
    format.textAlign === 'center' ||
    format.textAlign === 'right' ||
    format.textAlign === 'justify'
  ) {
    block.style.textAlign = format.textAlign
  }
}

// Single shared seeder for both the typing-into-empty-block flow and the
// post-Enter empty-block flow. Both want the same outcome: replace the empty
// block's content with the styled wrapper chain demanded by the typing
// snapshot, then place the caret at the end of the seeded text so the next
// keystroke extends the innermost text node naturally. Centralising this
// avoids a parallel implementation that drifted from the typing path.
//
// `text` is either the typed character (intercepted in beforeinput) or a
// ZWS placeholder (post-Enter, so the caret has somewhere to rest until the
// user types). Squire's MutationObserver auto-cleans the leftover ZWS once
// real content arrives.
function seedEmptyBlockWithFormat(
  editor: SquireInstance,
  block: HTMLElement,
  format: InlineTypingFormat,
  text: string
): void {
  const document = block.ownerDocument
  const seedTextNode = document.createTextNode(text)
  const formattedNode = wrapLeafWithTypingFormat(document, seedTextNode, format)

  editor.saveUndoState(editor.getSelection())
  applyBlockTypingFormat(block, format)
  block.replaceChildren(formattedNode)

  const range = document.createRange()
  range.setStart(seedTextNode, seedTextNode.data.length)
  range.collapse(true)
  editor.setSelection(range)
}

function restoreInlineTypingFormatIfEmpty(
  editor: SquireInstance,
  format: InlineTypingFormat
): void {
  if (!hasInlineTypingFormat(format)) {
    return
  }

  const range = editor.getSelection()
  if (!range.collapsed) {
    return
  }

  const block = findClosestTypingBlock(editor.getRoot(), range.startContainer)
  if (!block || !isEmptyTypingBlock(block)) {
    return
  }

  // Seed with a ZWS so the caret has a Text node to live in, inside the
  // innermost styled wrapper. Squire's chained set*Methods (which previously
  // drove this path) are sensitive to collapsed-range ordering and silently
  // leave the caret outside their wrappers in some edge cases — direct DOM
  // seeding is byte-for-byte deterministic instead.
  seedEmptyBlockWithFormat(editor, block, format, ZERO_WIDTH_SPACE)
}

// Decide which active style properties the typed character would *fail* to
// inherit at the current caret position.
//
// The check is grounded in `getComputedStyle(targetElement)`: the toolbar
// reports the *contextual* style (which may walk up to a sibling span via
// `findContextualStyleAnchors`), but what the user actually sees when they
// type is the **cascade-resolved** style of whatever element the inserted
// character would land in. If those two agree on every active property the
// cascade is doing the right thing and we must stay out of the browser's
// way (otherwise we just add DOM bloat). If they disagree — the canonical
// case is `<p style="color:dark"><span style="color:purple">&nbsp;</span></p>`
// with the caret outside the span: toolbar shows purple, cascade gives
// dark — we have to wrap the typed character ourselves so the visible glyph
// matches the toolbar.
function diffFormatVsCaretCascade(
  range: Range,
  format: InlineTypingFormat,
  document: Document
): InlineTypingFormat {
  const start = range.startContainer
  const target = isElementNode(start) ? start : start.parentElement
  const view = document.defaultView
  if (!target || !view) {
    return format
  }

  const cs = view.getComputedStyle(target)
  const remaining: InlineTypingFormat = { ...format }

  if (remaining.fontFamily) {
    const want = getPrimaryMailFontFamily(remaining.fontFamily)
    const have = getPrimaryMailFontFamily(cs.fontFamily)
    if (want && want === have) {
      remaining.fontFamily = null
    }
  }

  if (remaining.fontSizePx !== BASE_FONT_SIZE_PX) {
    const have = parseFontSizePx(cs.fontSize)
    if (have !== null && Math.abs(have - remaining.fontSizePx) <= 0.5) {
      remaining.fontSizePx = BASE_FONT_SIZE_PX
    }
  }

  if (remaining.color) {
    const want = resolveCssColorToHex(remaining.color, document)
    const have = resolveCssColorToHex(cs.color, document)
    if (want && want === have) {
      remaining.color = null
    }
  }

  if (remaining.highlight) {
    const want = resolveCssColorToHex(remaining.highlight, document)
    const have = resolveCssColorToHex(cs.backgroundColor, document)
    if (want && want === have) {
      remaining.highlight = null
    }
  }

  if (remaining.isBold && hasBoldWeight(cs.fontWeight)) {
    remaining.isBold = false
  }
  if (remaining.isItalic && /^italic|^oblique/i.test(cs.fontStyle)) {
    remaining.isItalic = false
  }
  if (remaining.isUnderline && cs.textDecorationLine.toLowerCase().includes('underline')) {
    remaining.isUnderline = false
  }
  if (remaining.isStrike && cs.textDecorationLine.toLowerCase().includes('line-through')) {
    remaining.isStrike = false
  }
  if (remaining.isSub && cs.verticalAlign.toLowerCase().includes('sub')) {
    remaining.isSub = false
  }
  if (remaining.isSup && cs.verticalAlign.toLowerCase().includes('super')) {
    remaining.isSup = false
  }

  // line-height / text-align are block-level properties: they're only
  // meaningful for the post-Enter / empty-block seeding paths (where we
  // apply them to the new <div>/<p> via `applyBlockTypingFormat`). For
  // inline typing they never appear on the wrapper span, so they must
  // NEVER drive the "should I intercept?" decision — otherwise every
  // keystroke inside a styled block produces a fresh, redundantly-wrapped
  // span and the user's toolbar actions stop taking effect.
  remaining.lineHeight = null
  remaining.textAlign = null

  return remaining
}

// Insert the typed character at the caret wrapped in the styling that the
// inline ancestor chain doesn't already carry. The browser's natural
// insertion would land the character at a point that loses that styling
// (most commonly: caret in a non-empty block whose visible glyph is held
// by an inner styled <span> the click landed beside, or caret at the very
// boundary of a block where `range.startContainer` is the block element
// itself). Wrapping at insertion preserves the toolbar-reported style on
// every keystroke regardless of how the surrounding HTML was authored.
function insertFormattedTextAtCursor(
  editor: SquireInstance,
  format: InlineTypingFormat,
  text: string
): void {
  const range = editor.getSelection()
  const document = editor.getRoot().ownerDocument
  if (!document) {
    return
  }
  const seedTextNode = document.createTextNode(text)
  const formattedNode = wrapLeafWithTypingFormat(document, seedTextNode, format)

  editor.saveUndoState(range)
  range.insertNode(formattedNode)

  const next = document.createRange()
  next.setStart(seedTextNode, seedTextNode.data.length)
  next.collapse(true)
  editor.setSelection(next)
}

function handleFormattedEmptyBlockBeforeInput(editor: SquireInstance, event: InputEvent): void {
  if (
    event.inputType !== 'insertText' ||
    event.isComposing ||
    !event.data ||
    event.data.length === 0
  ) {
    return
  }

  const range = editor.getSelection()
  if (!range.collapsed) {
    return
  }

  const format = readInlineTypingFormat(editor)
  if (!hasInlineTypingFormat(format)) {
    return
  }

  const block = findClosestTypingBlock(editor.getRoot(), range.startContainer)
  if (!block) {
    return
  }

  // If the cascade-resolved style at the caret already matches every active
  // property the toolbar is reporting, the browser's natural typing will
  // produce a glyph that visually matches the toolbar — leaving the DOM
  // alone keeps the typed text from accumulating redundant <span> wrappers.
  // Only when the cascade disagrees with the toolbar (the canonical case is
  // a styled <span> sitting beside the caret in a paragraph whose own
  // `color` differs) do we step in and seed the styling explicitly.
  const ownerDocument = editor.getRoot().ownerDocument
  if (!ownerDocument) {
    return
  }
  const uncovered = diffFormatVsCaretCascade(range, format, ownerDocument)
  if (!hasInlineTypingFormat(uncovered)) {
    return
  }

  event.preventDefault()

  if (isEmptyTypingBlock(block)) {
    seedEmptyBlockWithFormat(editor, block, format, event.data)
  } else {
    insertFormattedTextAtCursor(editor, format, event.data)
  }
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

const FONT_FAMILY_DECLARATION_PATTERN = /\bfont-family\s*:/i

// When the editor is initialized empty (or with the trivial `<p></p>` value
// that the composer uses as a sentinel for "blank message"), wrap the caret
// in a default block carrying the desired font-family inline. New typing
// inherits Century Gothic without forcing it on quoted/inserted content
// downstream — exactly the Gmail behaviour. For non-empty initial value with
// a leading authored block (reply/forward), apply the default to the first
// authored block before the gmail_quote so that the user's reply text
// inherits, while the quoted body retains its original styling.
function applyDefaultFontFamilyToInitialHtml(
  rawHtml: string,
  defaultFontFamily: string | null
): string {
  if (!defaultFontFamily) {
    return rawHtml
  }

  const trimmed = rawHtml.trim()

  if (!trimmed || /^<p>\s*(?:<br\s*\/?>)?\s*<\/p>$/i.test(trimmed)) {
    return `<div style="font-family: ${defaultFontFamily}"><br></div>`
  }

  const document = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, 'text/html')
  const root = document.body.firstElementChild as HTMLElement | null

  if (!root) {
    return rawHtml
  }

  // Two-pass: first detect whether any leading authored block is missing a
  // font-family declaration. If everything is already styled, return the
  // input string verbatim so the caller's referential check
  // `value === lastSynced` short-circuits and we don't trigger a needless
  // setHTML round-trip on every controlled re-render.
  let needsTransform = false
  for (const child of root.children) {
    const tagName = child.tagName.toLowerCase()
    if (tagName === 'blockquote' || child.classList.contains('gmail_quote')) {
      break
    }
    if (isElementNode(child)) {
      if (!FONT_FAMILY_DECLARATION_PATTERN.test(child.getAttribute('style') ?? '')) {
        needsTransform = true
        break
      }
    }
  }

  if (!needsTransform) {
    return rawHtml
  }

  for (const child of [...root.children]) {
    const tagName = child.tagName.toLowerCase()
    if (tagName === 'blockquote') {
      break
    }
    if (child.classList.contains('gmail_quote')) {
      break
    }

    if (isElementNode(child)) {
      const existingStyle = child.getAttribute('style') ?? ''
      if (!FONT_FAMILY_DECLARATION_PATTERN.test(existingStyle)) {
        const cleaned = existingStyle.trim().replace(/;+$/g, '')
        const merged = cleaned
          ? `${cleaned}; font-family: ${defaultFontFamily}`
          : `font-family: ${defaultFontFamily}`
        child.setAttribute('style', merged)
      }
    }
  }

  return root.innerHTML
}

interface UseSquireInstanceOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  initialHtml: string
  placeholder: string
  defaultFontFamily: string | null
  disabled: boolean
  onChange: (html: string) => void
}

interface SquireBootstrap {
  ready: boolean
  editor: SquireInstance | null
}

// Squire seeds empty blocks with U+200B (zero-width space) on WebKit so the
// caret can land in them. We strip those out when sniffing for "is the body
// genuinely empty?" — otherwise the placeholder pseudo-element never appears.
const ZERO_WIDTH_SPACE_PATTERN = new RegExp(ZERO_WIDTH_SPACE, 'g')

// Toggle `data-empty` on the iframe's <html> element, NOT on body. Squire
// observes body with `subtree: true, attributes: true`, so any setAttribute
// on body fires its MutationObserver → `input` event. If `handleInput` then
// writes back to body's `data-empty`, we get an infinite microtask loop that
// freezes the renderer. Mutations on ancestors of the observed root are
// never reported, so writing to <html> is safe. The CSS rule reads the flag
// from <html> and the placeholder text from body via `attr()`.
function refreshEmptyState(body: HTMLElement): void {
  const text = body.textContent?.replace(ZERO_WIDTH_SPACE_PATTERN, '').trim() ?? ''
  const hasMedia = Boolean(body.querySelector('img, table'))
  const next = !text && !hasMedia ? 'true' : 'false'
  const documentElement = body.ownerDocument.documentElement
  if (documentElement.getAttribute('data-empty') !== next) {
    documentElement.setAttribute('data-empty', next)
  }
}

function useSquireInstance(options: UseSquireInstanceOptions): SquireBootstrap {
  const { iframeRef, initialHtml, placeholder, defaultFontFamily, disabled, onChange } = options
  const [ready, setReady] = useState(false)
  const editorRef = useRef<SquireInstance | null>(null)
  const onChangeRef = useRef(onChange)
  // Track the last `initialHtml` value we pushed into Squire. Comparing the
  // *prop* (not the HTML round-trip from `editor.getHTML()`) is what makes
  // the controlled-component pattern stable: Squire reformats on setHTML so
  // round-trip equality is unreliable, but the prop reference is stable.
  const lastSyncedHtmlRef = useRef<string | null>(null)
  const isApplyingExternalValueRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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
  // We deliberately do NOT depend on `initialHtml` / `placeholder` here —
  // those are pushed via dedicated effects below. Re-creating the iframe on
  // every prop change would wipe the editor and the user's caret/undo.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) {
      return
    }

    let disposed = false
    const frameCleanupFns: Array<() => void> = []

    const teardown = (): void => {
      disposed = true
      while (frameCleanupFns.length > 0) {
        frameCleanupFns.pop()?.()
      }
      const editor = editorRef.current
      if (editor) {
        try {
          editor.destroy()
        } catch (error) {
          console.warn('[mail-editor] destroy failed', error)
        }
        editorRef.current = null
      }
      lastSyncedHtmlRef.current = null
      setReady(false)
    }

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
        console.error(
          '[mail-editor] Squire constructor not found on iframe.contentWindow.\n' +
            '→ Did the bundled squire script load? URL:',
          squireScriptUrl,
          '\n→ Document readyState:',
          frameDocument.readyState,
          '\n→ contentWindow keys (first 30):',
          Object.keys(frameWindow as object).slice(0, 30)
        )
        return
      }

      const blockAttributes = defaultFontFamily
        ? { style: `font-family: ${defaultFontFamily}` }
        : null

      const handlePreSquireKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) {
          return
        }

        const editor = editorRef.current
        if (!editor) {
          return
        }

        const format = readInlineTypingFormat(editor)
        frameWindow.setTimeout(() => {
          if (!disposed && editorRef.current === editor) {
            restoreInlineTypingFormatIfEmpty(editor, format)
          }
        }, 0)
      }

      const handlePreSquireBeforeInput = (event: InputEvent): void => {
        const editor = editorRef.current
        if (!editor || event.defaultPrevented) {
          return
        }
        handleFormattedEmptyBlockBeforeInput(editor, event)
      }

      frameDocument.body.addEventListener('keydown', handlePreSquireKeyDown, true)
      frameDocument.body.addEventListener('beforeinput', handlePreSquireBeforeInput, true)
      frameCleanupFns.push(() => {
        frameDocument.body.removeEventListener('keydown', handlePreSquireKeyDown, true)
        frameDocument.body.removeEventListener('beforeinput', handlePreSquireBeforeInput, true)
      })

      let editor: SquireInstance
      try {
        editor = new SquireClass(frameDocument.body, {
          blockTag: 'div',
          blockAttributes,
          // Distinct, private marker classes per property. Squire's
          // `_removeFormat` matches SPANs by `class=<className>`; if the four
          // classes were the same (or all empty) each set-method would unwrap
          // the spans created by the others, making font-family / font-size /
          // colour / highlight mutually exclusive on a single text run.
          // We strip these markers on output (`willCutCopy` and below in
          // `handleInput`) so the wire format stays inline-style-only.
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

      editorRef.current = editor

      isApplyingExternalValueRef.current = true
      editor.modifyDocument(() => {
        editor.setHTML(initialHtml)
      })
      isApplyingExternalValueRef.current = false
      lastSyncedHtmlRef.current = initialHtml

      const handleInput = (): void => {
        if (isApplyingExternalValueRef.current) {
          return
        }
        const rawHtml = editor.getHTML()
        const html = stripEditorMarkerClassesFromHtml(rawHtml, frameDocument)
        lastSyncedHtmlRef.current = html
        refreshEmptyState(frameDocument.body)
        onChangeRef.current(html)
      }

      editor.addEventListener('input', handleInput)
      refreshEmptyState(frameDocument.body)

      // Squire force-sets contenteditable=true at construction; only override
      // when `disabled` actually requires read-only — assigning the same
      // value still routes through setAttribute and would trip Squire's
      // MutationObserver chain (see `refreshEmptyState` for context).
      if (disabled && frameDocument.body.contentEditable !== 'false') {
        frameDocument.body.contentEditable = 'false'
      }

      setReady(true)
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
      iframe.removeEventListener('load', handleLoad)
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef])

  // Keep the editor's HTML in sync when the parent passes a new external value
  // (signature load, reply/forward bootstrap, retry-after-failure, …). Compare
  // the *prop* against the last value we pushed in — see the comment on
  // `lastSyncedHtmlRef` above.
  useEffect(() => {
    if (!ready) {
      return
    }
    const editor = editorRef.current
    if (!editor) {
      return
    }
    if (lastSyncedHtmlRef.current === initialHtml) {
      return
    }

    lastSyncedHtmlRef.current = initialHtml
    isApplyingExternalValueRef.current = true
    editor.modifyDocument(() => {
      editor.setHTML(initialHtml)
    })
    isApplyingExternalValueRef.current = false
    refreshEmptyState(editor.getRoot())
  }, [initialHtml, ready])

  // Placeholder text is bonded to the iframe srcdoc once at construction
  // (see `buildMailFrameDocument` in mail-html.ts). We deliberately do NOT
  // mutate `body[data-placeholder]` post-mount: it would fire Squire's body
  // MutationObserver and chain through `input → handleInput → setAttribute
  // → MutationObserver → …` until the renderer freezes. Placeholder is a
  // prop that effectively never changes during an editor's lifetime in
  // this app, so set-once-at-srcdoc is the right trade-off.

  // Toggle the caret editable state when the dialog flips `disabled`.
  useEffect(() => {
    if (!ready) {
      return
    }
    const editor = editorRef.current
    if (!editor) {
      return
    }
    // Skip the assignment if the value is already correct — the IDL setter
    // calls setAttribute under the hood, and writing to body's attributes
    // outside Squire's modifyDocument bracket fires its MutationObserver
    // and triggers a stray `input` event we'd then have to ignore.
    const root = editor.getRoot()
    const target = disabled ? 'false' : 'true'
    if (root.contentEditable !== target) {
      root.contentEditable = target
    }
  }, [disabled, ready])

  return { ready, editor: editorRef.current }
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
        isBold: editor.hasFormat('B'),
        isItalic: editor.hasFormat('I'),
        isUnderline: editor.hasFormat('U'),
        isStrike: editor.hasFormat('S'),
        isSub: editor.hasFormat('SUB'),
        isSup: editor.hasFormat('SUP'),
        isUL: pathHasPattern(path, PATH_PATTERNS.ul),
        isOL: pathHasPattern(path, PATH_PATTERNS.ol),
        isLink: pathHasPattern(path, PATH_PATTERNS.link),
        isQuote: pathHasPattern(path, QUOTE_PATH_PATTERN),
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
  value,
  placeholder = "Scrivi il contenuto dell'email...",
  disabled = false,
  expanded,
  showExpandToggle = true,
  expandToContainer,
  defaultFontFamily = MAIL_EDITOR_DEFAULT_FONT_FAMILY,
  onExpandedChange,
  onChange
}: RichTextEditorProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [editorExpandedInternal, setEditorExpandedInternal] = useState(false)
  const [fontFamilyMenuOpen, setFontFamilyMenuOpen] = useState(false)
  const [fontSizeMenuOpen, setFontSizeMenuOpen] = useState(false)
  const [headingMenuOpen, setHeadingMenuOpen] = useState(false)
  const [alignmentMenuOpen, setAlignmentMenuOpen] = useState(false)
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false)
  const [fontSizeInputFocused, setFontSizeInputFocused] = useState(false)
  const [fontSizeDraft, setFontSizeDraft] = useState('')
  const [lineHeightMenuOpen, setLineHeightMenuOpen] = useState(false)
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

  const editorExpanded = expanded ?? editorExpandedInternal
  const normalizedDefaultFontFamily = normalizeMailFontFamilyValue(defaultFontFamily)

  const setEditorExpanded = useCallback(
    (next: boolean): void => {
      if (onExpandedChange) {
        onExpandedChange(next)
        return
      }
      setEditorExpandedInternal(next)
    },
    [onExpandedChange]
  )

  // Apply the default font family to the leading authored block of the
  // incoming value (idempotent — does nothing if the block already has a
  // font-family declaration). The hook compares this transformed prop against
  // its internal "last synced" reference, so passing it on every render is
  // safe: equal values short-circuit, mutations push a new setHTML.
  const initialHtml = applyDefaultFontFamilyToInitialHtml(value, normalizedDefaultFontFamily)

  const handleEditorChange = useCallback(
    (html: string): void => {
      onChange(html, htmlToPlainText(html))
    },
    [onChange]
  )

  const { editor } = useSquireInstance({
    iframeRef,
    initialHtml,
    placeholder,
    defaultFontFamily: normalizedDefaultFontFamily,
    disabled,
    onChange: handleEditorChange
  })

  const active = useEditorActiveState(editor)

  // The font-size input shows `active.fontSizePx` directly when not focused
  // and the user's `fontSizeDraft` while typing — see the input's `value`
  // binding below. We only seed the draft on focus / fill on option-pick,
  // so no cross-state sync effect is needed.

  // Line-height is applied only when the user explicitly picks a value from
  // the menu — never on first mount. Pushing it on mount would clobber the
  // line-height authored by senders inside reply / forward / paste content.

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

  const toggleBulletList = useCallback((): void => {
    runWithFocus((e) => (active.isUL ? e.removeList() : e.makeUnorderedList()))
  }, [active.isUL, runWithFocus])

  const toggleOrderedList = useCallback((): void => {
    runWithFocus((e) => (active.isOL ? e.removeList() : e.makeOrderedList()))
  }, [active.isOL, runWithFocus])

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
      title: 'Grassetto'
    },
    {
      id: 'italic',
      icon: Italic,
      active: active.isItalic,
      disabled: toolButtonDisabled,
      action: toggleItalic,
      title: 'Corsivo'
    },
    {
      id: 'underline',
      icon: UnderlineIcon,
      active: active.isUnderline,
      disabled: toolButtonDisabled,
      action: toggleUnderline,
      title: 'Sottolineato'
    },
    {
      id: 'strike',
      icon: Strikethrough,
      active: active.isStrike,
      disabled: toolButtonDisabled,
      action: toggleStrike,
      title: 'Barrato'
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
      title: 'Lista puntata'
    },
    {
      id: 'ordered-list',
      icon: ListOrdered,
      active: active.isOL,
      disabled: toolButtonDisabled,
      action: toggleOrderedList,
      title: 'Lista numerata'
    }
  ]
  const indentQuoteButtons: ToolbarButton[] = [
    {
      id: 'outdent',
      icon: Outdent,
      active: false,
      disabled: toolButtonDisabled,
      action: decreaseIndent,
      title: 'Riduci rientro'
    },
    {
      id: 'indent',
      icon: Indent,
      active: false,
      disabled: toolButtonDisabled,
      action: increaseIndent,
      title: 'Aumenta rientro'
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
        'mail-editor border-border overflow-hidden rounded-lg border bg-transparent',
        expandToContainer && 'flex h-full min-h-0 flex-col'
      )}
    >
      <TooltipProvider delayDuration={180}>
        <div className="border-border bg-card/80 flex items-start gap-2 border-b p-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
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
                    className="h-8 max-w-[10rem] gap-1 px-2 text-xs font-medium"
                    onMouseDown={(event) => event.preventDefault()}
                    title="Font"
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
                      title="Dimensione testo"
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
                    title="Colore testo"
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
                    title="Colore sfondo testo"
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

            {renderToolbarButton(
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
                    title="Titoli"
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

            {inlineMarkButtons.map((button) => {
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
                  title={button.title}
                  disabled={button.disabled || !editor}
                >
                  <Icon className="size-4" />
                </Button>
              )
            })}

            {renderToolbarButton(
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
                    title="Allineamento"
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
                  title={button.title}
                  disabled={button.disabled || !editor}
                >
                  <Icon className="size-4" />
                </Button>
              )
            })}

            {indentQuoteButtons.map((button) => {
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
                  title={button.title}
                  disabled={button.disabled || !editor}
                >
                  <Icon className="size-4" />
                </Button>
              )
            })}

            {renderToolbarButton(
              'line-height',
              'Interlinea',
              <DropdownMenu
                open={lineHeightMenuOpen}
                onOpenChange={setLineHeightMenuOpen}
                modal={false}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={
                      lineHeightMenuOpen ||
                      (active.lineHeightRatio !== null &&
                        Math.abs(active.lineHeightRatio - Number(DEFAULT_EDITOR_LINE_HEIGHT)) >
                          0.02)
                        ? 'secondary'
                        : 'ghost'
                    }
                    size="icon"
                    className="size-8"
                    onMouseDown={(event) => event.preventDefault()}
                    title="Interlinea"
                    disabled={disabled || !editor}
                  >
                    <LineSpacingIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-[4.5rem] p-1"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  {EDITOR_LINE_HEIGHT_OPTIONS.map((option) => {
                    // Match the option to the cascade-resolved ratio from the
                    // caret. When nothing matches (e.g. caret on a paragraph
                    // whose authored line-height is 1.4 — not in our presets,
                    // or `normal`), no checkmark is shown — same UX as Gmail.
                    const checked =
                      active.lineHeightRatio !== null &&
                      Math.abs(active.lineHeightRatio - Number(option.value)) < 0.02
                    return (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={checked}
                        className="text-xs"
                        onSelect={(event) => {
                          event.preventDefault()
                          if (editor) {
                            applyLineHeight(editor, option.value)
                            editor.focus()
                          }
                          setLineHeightMenuOpen(false)
                        }}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {renderToolbarButton(
              'inline-media',
              'Inserisci media nel contenuto',
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={openMediaPicker}
                onMouseDown={(event) => event.preventDefault()}
                title="Inserisci media nel contenuto"
                disabled={disabled || !editor}
              >
                <ImagePlus className="size-4" />
              </Button>
            )}

            {renderToolbarButton(
              'link',
              'Link',
              <Button
                type="button"
                variant={active.isLink ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8"
                onClick={openLinkEditor}
                onMouseDown={(event) => event.preventDefault()}
                title="Link"
                disabled={disabled || !editor}
              >
                <Link2 className="size-4" />
              </Button>
            )}

            {renderToolbarButton(
              'clear-formatting',
              'Rimuovi formattazione',
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={clearFormatting}
                onMouseDown={(event) => event.preventDefault()}
                title="Rimuovi formattazione"
                disabled={disabled || !editor || active.isEmpty}
              >
                <RemoveFormatting className="size-4" />
              </Button>
            )}
          </div>

          {showExpandToggle &&
            renderToolbarButton(
              'toggle-editor-size',
              editorExpanded ? 'Riduci box di scrittura' : 'Espandi box di scrittura',
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 self-start"
                onClick={() => setEditorExpanded(!editorExpanded)}
                onMouseDown={(event) => event.preventDefault()}
                title={editorExpanded ? 'Riduci box di scrittura' : 'Espandi box di scrittura'}
              >
                {editorExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </Button>
            )}
        </div>
      </TooltipProvider>

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
          expandToContainer ? 'min-h-0 flex-1' : editorExpanded ? 'h-[560px]' : 'h-[350px]'
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
