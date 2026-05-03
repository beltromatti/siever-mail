import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify'

import { normalizeMailFontFamilyValue } from './mail-fonts'
import centuryGothicRegularUrl from '../../../../resources/centurygothic.ttf?url'

export interface NormalizedMailHtml {
  bodyHtml: string
  headHtml: string
}

export interface MailFrameDocumentOptions {
  bodyHtml: string
  headHtml?: string
  editable?: boolean
  placeholder?: string
  /**
   * Absolute URL of an external script to load synchronously inside the
   * iframe document. Used by the editor to inject the Squire bundle —
   * inline scripts get blocked by the renderer's CSP `script-src 'self'`,
   * so we must reference an asset URL instead.
   */
  scriptUrl?: string
}

// Shared sanitization profile. Same policy used by viewer (read-only iframe)
// and editor (Squire's `sanitizeToDOMFragment`). Marketing emails ride on
// `<table>`, `<font face>`, embedded `<style>`, inline color/width/height —
// keep all of that. Strip every script/redirection/external-resource vector.
const SANITIZE_OPTIONS: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['face', 'style'],
  FORBID_TAGS: [
    'script',
    'iframe',
    'frame',
    'frameset',
    'object',
    'embed',
    'portal',
    'base',
    'meta',
    'link'
  ]
}

function appendInlineStyle(styleValue: string | null | undefined, declaration: string): string {
  const normalized = (styleValue ?? '').trim().replace(/;+$/g, '')
  return normalized ? `${normalized}; ${declaration}` : declaration
}

function migrateLegacyFaceAttributes(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll<HTMLElement>('[face]')]) {
    const legacyFace = normalizeMailFontFamilyValue(element.getAttribute('face'))
    const hasInlineFont = /\bfont-family\s*:/i.test(element.getAttribute('style') ?? '')

    if (legacyFace && !hasInlineFont) {
      element.setAttribute(
        'style',
        appendInlineStyle(element.getAttribute('style'), `font-family:${legacyFace}`)
      )
    }

    element.removeAttribute('face')
  }
}

// Sanitize raw email HTML and split out any embedded `<style>` blocks so the
// caller can place them in `<head>` (where Outlook-compat templates expect to
// find them). Embedded styles drive ~half the visual fidelity of marketing
// emails — moving them to head keeps cascade order intact inside the frame.
export function sanitizeMailHtml(rawHtml: string): NormalizedMailHtml {
  const sanitized = DOMPurify.sanitize(rawHtml, SANITIZE_OPTIONS)

  if (typeof sanitized !== 'string' || !sanitized.trim()) {
    return { bodyHtml: '', headHtml: '' }
  }

  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  const headNodes: string[] = []

  for (const styleElement of [...document.querySelectorAll('style')]) {
    headNodes.push(styleElement.outerHTML)
    styleElement.remove()
  }

  migrateLegacyFaceAttributes(document.body)

  return {
    bodyHtml: document.body.innerHTML.trim(),
    headHtml: headNodes.join('\n')
  }
}

// Squire calls its `sanitizeToDOMFragment` config option for setHTML / paste /
// insertHTML. The fragment must be owned by the editor's document (the iframe
// document), so we sanitize in our context and then `importNode` across realms.
export function sanitizeMailHtmlToFragment(
  rawHtml: string,
  targetDocument: Document
): DocumentFragment {
  const cleaned = DOMPurify.sanitize(rawHtml, {
    ...SANITIZE_OPTIONS,
    RETURN_DOM_FRAGMENT: true,
    FORCE_BODY: false
  })

  if (cleaned instanceof DocumentFragment) {
    migrateLegacyFaceAttributes(cleaned as unknown as HTMLElement)
    return targetDocument.importNode(cleaned, true) as DocumentFragment
  }

  return targetDocument.createDocumentFragment()
}

// Baseline CSS shared by viewer and editor. Intentionally minimal and never
// uses `!important` — the email author's CSS must always win. Gmail follows
// the same philosophy. The Century Gothic @font-face is what gives our default
// authored content its identity.
const MAIL_FRAME_BASELINE_CSS = `
@font-face {
  font-family: 'Century Gothic';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src:
    local('Century Gothic'),
    url('${centuryGothicRegularUrl}') format('truetype');
}

html {
  color-scheme: light;
  background: #ffffff;
  overflow-x: auto;
  overflow-y: hidden;
}

body {
  margin: 0;
  padding: 14px 18px 18px;
  background: #ffffff;
  color: #1f2328;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    Arial,
    'Apple Color Emoji',
    'Segoe UI Emoji',
    sans-serif;
  font-size: 14px;
  /* Matches the editor's Interlinea toolbar default
     (DEFAULT_EDITOR_LINE_HEIGHT in rich-text-editor.tsx). Lines that
     do not carry an explicit line-height inherit this value, so they
     render at the same vertical rhythm as the signature blocks (which
     all declare line-height 1.5). */
  line-height: 1.5;
  font-synthesis: weight style;
}

body > :first-child {
  margin-top: 0;
}

a {
  color: #0b57d0;
}

img,
video,
canvas {
  max-width: 100%;
  height: auto;
}

/* Match Gmail / Outlook: the P element ships with no implicit margin so
   the signatures' paragraph rhythm equals what freshly-typed DIV lines
   produce (DIV has no UA margin). Without this rule the editor uses
   0.45rem and the viewer falls back to the browser default 1em — both
   make the same email look far looser than how Gmail renders it. Authors
   who want vertical separation use empty paragraphs / line breaks (what
   our signature already does). */
p {
  margin: 0;
}
`

// Editor-only additions on top of the shared baseline: live caret, placeholder
// pseudo-element, blockquote/gmail_quote affordances that match the viewer's
// look, and minimal styling for Squire's image-resize handles.
//
// IMPORTANT: the empty-state flag lives on the <html> element, NOT on body.
// Squire installs a MutationObserver on body with `subtree:true`, so any
// attribute mutation on body or its descendants fires `'input'` events.
// Toggling data-empty on body in response to those events would create an
// infinite microtask loop that freezes the renderer. Mutations on ancestors
// of the observed root are ignored, so we tag <html> instead.
const MAIL_FRAME_EDITOR_CSS = `
html, body {
  height: 100%;
}

html {
  overflow-y: auto;
}

body {
  outline: none;
  caret-color: #0b57d0;
  cursor: text;
  min-height: 100%;
  /* Anchor for the absolute-positioned placeholder. */
  position: relative;
}

/* Standard input-field placeholder UX: the hint text sits exactly on the
   first authored line (offset matches body padding) and disappears as soon
   as the body receives focus — even before typing — so the caret has a
   clean leading position. The blur path returns the hint when the body
   loses focus while still empty, matching native <input>/<textarea>. */
html[data-empty='true'] body:not(:focus)::before {
  content: attr(data-placeholder);
  position: absolute;
  top: 14px;
  left: 18px;
  right: 18px;
  color: rgba(15, 23, 42, 0.45);
  pointer-events: none;
}

blockquote,
.gmail_quote {
  margin: 0.45rem 0 0.45rem 0.8ex;
  padding-left: 1ex;
  border-left: 1px solid rgba(15, 23, 42, 0.18);
  color: #1f2328;
}

.gmail_attr {
  color: rgba(15, 23, 42, 0.6);
  font-size: 0.92em;
  line-height: 1.45;
  margin: 0.35rem 0;
}

ul, ol {
  margin: 0.55rem 0;
  padding-left: 1.35rem;
}

ul { list-style-type: disc; }
ol { list-style-type: decimal; }

li { margin: 0.2rem 0; }

img {
  display: inline-block;
  max-width: 100%;
  height: auto;
}

.squire-resize-container {
  display: inline-block;
  position: relative;
}

.squire-resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #2563eb;
  border: 1px solid #ffffff;
  border-radius: 50%;
  z-index: 2;
}
`

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function buildMailFrameDocument(options: MailFrameDocumentOptions): string {
  const { bodyHtml, headHtml = '', editable = false, placeholder = '', scriptUrl } = options
  // The placeholder text lives on body so the `attr()` CSS function can read
  // it. The empty-state flag lives on <html> (see MAIL_FRAME_EDITOR_CSS for
  // the rationale around Squire's MutationObserver).
  const htmlAttributes = editable ? ` data-empty="true"` : ''
  const bodyAttributes = editable
    ? ` data-squireinit="true" data-placeholder="${escapeAttribute(placeholder)}"`
    : ''
  const styleBlock = `<style>${MAIL_FRAME_BASELINE_CSS}${editable ? MAIL_FRAME_EDITOR_CSS : ''}</style>`
  // External script tag (parser-blocking by default) — the iframe `load` event
  // fires only after this script has been fetched and executed, which lets the
  // editor wrapper assume Squire is on `iframe.contentWindow` once load fires.
  const scriptTag = scriptUrl ? `<script src="${escapeAttribute(scriptUrl)}"></script>` : ''

  return `<!doctype html>
<html${htmlAttributes}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${styleBlock}
    ${headHtml}
    ${scriptTag}
  </head>
  <body${bodyAttributes}>
    ${bodyHtml}
  </body>
</html>`
}
