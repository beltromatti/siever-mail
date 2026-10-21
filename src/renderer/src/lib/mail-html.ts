import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify'

import extensionRenderer from '@app/extension/renderer'
import { normalizeMailFontFamilyValue } from '@shared/mail-fonts'

export interface MailFrameDocumentOptions {
  bodyHtml: string
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

// The editor's sanitization profile. The composer runs a script (Squire) on
// a page the app can reach, so what is pasted or set into it is cleaned of
// every script, redirection and embedding vector. Marketing emails ride on
// `<table>`, `<font face>`, inline colours and sizes — all of that stays.
const EDITOR_SANITIZE_OPTIONS: DOMPurifyConfig = {
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

/**
 * What a received message cannot do in the reading pane anyway: its frame
 * runs no script and loads no plugin (sandbox and CSP), may not navigate,
 * and is laid out by the app's own document head. These are taken out
 * rather than left inert, and nothing else in the message is touched.
 */
const INERT_IN_READER_SELECTOR = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'base',
  'meta',
  'title'
].join(', ')

function appendInlineStyle(styleValue: string | null | undefined, declaration: string): string {
  const normalized = (styleValue ?? '').trim().replace(/;+$/g, '')
  return normalized ? `${normalized}; ${declaration}` : declaration
}

function migrateLegacyFaceAttributes(root: ParentNode): void {
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

// Squire calls its `sanitizeToDOMFragment` config option for setHTML / paste /
// insertHTML. The fragment must be owned by the editor's document (the iframe
// document), so we sanitize in our context and then `importNode` across realms.
export function sanitizeMailHtmlToFragment(
  rawHtml: string,
  targetDocument: Document
): DocumentFragment {
  const cleaned = DOMPurify.sanitize(rawHtml, {
    ...EDITOR_SANITIZE_OPTIONS,
    RETURN_DOM_FRAGMENT: true,
    FORCE_BODY: false
  })

  if (cleaned instanceof DocumentFragment) {
    migrateLegacyFaceAttributes(cleaned)
    return targetDocument.importNode(cleaned, true) as DocumentFragment
  }

  return targetDocument.createDocumentFragment()
}

// The fonts an extension bundles, in every message frame — read, written
// or sent — so they render the same on every machine.
const FONT_FACE_CSS = extensionRenderer.fontFaceCss

// The canvas every message is shown on. Mail is authored for a white page,
// so the frame stays white in every app theme, with a scrollbar tuned for
// white that keeps the app's shape: a 6px rounded thumb inset in a 10px
// track, no arrow buttons.
const MAIL_CANVAS_CSS = `
html {
  color-scheme: light;
  background: #ffffff;
  overflow-x: auto;
  overflow-y: hidden;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track,
::-webkit-scrollbar-corner {
  background: transparent;
}

::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}

::-webkit-scrollbar-thumb {
  min-height: 32px;
  min-width: 32px;
  border: 2px solid transparent;
  border-radius: 9999px;
  background-color: rgba(31, 35, 40, 0.24);
  background-clip: content-box;
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(31, 35, 40, 0.4);
}
`

/**
 * What a page shows when its author said nothing: a readable face and
 * size, black text, blue links. Every rule sits in `:where()`, which has no
 * specificity, so any rule or style in the message wins over it — the
 * message is laid out as its author wrote it, exactly as in any other
 * client. Shared by the reader, the composer and sending, so a message
 * looks the same in all three.
 */
const MAIL_DEFAULTS_CSS = `
:where(body) {
  margin: 0;
  color: #000000;
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
  font-synthesis: weight style;
}

:where(a) {
  color: #0b57d0;
}
`

// The breathing space around a message in the reading pane. On the root,
// which messages leave alone, so a newsletter that zeroes its body's margin
// still does not touch the frame's edge.
const READER_CSS = `
html {
  padding: 14px 18px 18px;
}
`

// Editor-only additions: the writing margin, the caret, the placeholder and
// Squire's image-resize handles. Nothing here may change how content lays
// out — the composer has to show the message as it will arrive.
//
// IMPORTANT: the empty-state flag lives on the <html> element, NOT on body.
// Squire installs a MutationObserver on body with `subtree:true`, so any
// attribute mutation on body or its descendants fires `'input'` events.
// Toggling data-empty on body in response to those events would create an
// infinite microtask loop that freezes the renderer. Mutations on ancestors
// of the observed root are ignored, so we tag <html> instead.
const EDITOR_CSS = `
html, body {
  height: 100%;
}

html {
  overflow-y: auto;
}

body {
  padding: 14px 18px 18px;
  box-sizing: border-box;
  outline: none;
  caret-color: #0b57d0;
  cursor: text;
  min-height: 100%;
  /* Anchor for the absolute-positioned placeholder. */
  position: relative;
}

body > :first-child {
  margin-top: 0;
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

/** Marks the style sheet the app adds to a message, apart from the author's own. */
export const MAIL_APP_STYLE_ATTRIBUTE = 'data-mail-app'

function appStyleElement(document: Document, css: string): HTMLStyleElement {
  const style = document.createElement('style')
  style.setAttribute(MAIL_APP_STYLE_ATTRIBUTE, '')
  style.textContent = css
  return style
}

/**
 * The document a received message is shown in: the message itself, head
 * and body, as its author wrote it — its own style sheets included, which
 * is what lays out every message Outlook writes (`p.MsoNormal { margin: 0 }`)
 * and most newsletters. The app only adds its canvas and its defaults
 * ahead of the message's own rules, and takes out what could not run in
 * the frame anyway (`INERT_IN_READER_SELECTOR`).
 *
 * The frame it goes into is sandboxed without scripts and inherits the
 * app's content security policy, so nothing in the message can run, load a
 * plugin, submit a form or reach the app.
 */
export function buildMessageFrameDocument(rawHtml: string): string {
  const document = new DOMParser().parseFromString(rawHtml, 'text/html')

  for (const element of [...document.querySelectorAll(INERT_IN_READER_SELECTOR)]) {
    element.remove()
  }

  const charset = document.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  document.head.prepend(
    charset,
    appStyleElement(document, `${FONT_FACE_CSS}${MAIL_CANVAS_CSS}${MAIL_DEFAULTS_CSS}${READER_CSS}`)
  )

  return `<!doctype html>\n${document.documentElement.outerHTML}`
}

/**
 * The document a message being written is laid out in — by the composer,
 * and once more off screen when it is sent. Same canvas and defaults as the
 * reader, so what is written looks as it will be read.
 */
export function buildMailFrameDocument(options: MailFrameDocumentOptions): string {
  const { bodyHtml, editable = false, placeholder = '', scriptUrl } = options
  // The placeholder text lives on body so the `attr()` CSS function can read
  // it. The empty-state flag lives on <html> (see EDITOR_CSS for the
  // rationale around Squire's MutationObserver).
  const htmlAttributes = editable ? ` data-empty="true"` : ''
  const bodyAttributes = editable
    ? ` data-squireinit="true" data-placeholder="${escapeAttribute(placeholder)}"`
    : ''
  const styleBlock = `<style>${FONT_FACE_CSS}${MAIL_CANVAS_CSS}${MAIL_DEFAULTS_CSS}${editable ? EDITOR_CSS : ''}</style>`
  // External script tag (parser-blocking by default) — the iframe `load` event
  // fires only after this script has been fetched and executed, which lets the
  // editor wrapper assume Squire is on `iframe.contentWindow` once load fires.
  const scriptTag = scriptUrl ? `<script src="${escapeAttribute(scriptUrl)}"></script>` : ''

  return `<!doctype html>
<html${htmlAttributes}>
  <head>
    <meta charset="utf-8" />
    ${styleBlock}
    ${scriptTag}
  </head>
  <body${bodyAttributes}>
    ${bodyHtml}
  </body>
</html>`
}
