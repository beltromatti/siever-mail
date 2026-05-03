import type { ParsedMail } from 'mailparser'
import { simpleParser } from 'mailparser'

export const PREVIEW_MAX_LENGTH = 200

// ---------------------------------------------------------------------------
// The preview pipeline is the cheap side of the "does this email look useful
// in a list" question. It has to handle three classes of input:
//
//   1. Plain-text emails (human correspondence, transactional notices).
//   2. Marketing / newsletter emails with a `multipart/alternative` structure
//      where the text part is often a one-line "view in browser" URL while
//      the real copy lives only in the HTML part.
//   3. HTML-only emails (some transactional providers), where a mis-stripped
//      preview would leak raw DOCTYPE / tag noise into the message list.
//
// Strategy: clean the text candidate, assess its "meaningful word" count, and
// if it's obviously poor (< 4 words) fall back to the HTML candidate after a
// tag-stripper designed for noisy marketing output (decorative runs,
// markdown-flavoured link syntax, bare URLs, empty anchor fragments). Work
// stays regex-only and limited to the already-truncated source, so the cost
// per email is sub-millisecond even on bulk bootstrap.
// ---------------------------------------------------------------------------

const QUOTED_ATTRIBUTION_REGEX =
  /^(?:on .+wrote:|il .+ha scritto:|-{2,}\s*(?:original message|messaggio originale|forwarded message|messaggio inoltrato)\s*-{2,}|from:|da:|mittente:|sent:|date:|to:|a:|subject:|oggetto:)/i

// Markdown-ish constructs that html-to-text converters frequently emit:
//   [Visit now](https://example.com)  → keep the label
//   [](https://example.com)           → drop
//   ( # )  or  (#)                    → drop (empty anchor)
const MARKDOWN_LINK_PATTERN = /\[([^\]]*)\]\(([^)]*)\)/g
// Markdown-link whose closing paren was sliced off by preview truncation
// (e.g. a stored 200-char preview cut at `[Woman](https://nude-proj`).
const TRUNCATED_MARKDOWN_LINK_TAIL_PATTERN = /\[[^\]\n]*\]\([^)\n]*$/
// Stand-alone bracketed label without an adjacent link — keep the label text
// since it often is a meaningful image alt (`[Bolt]`, `[Logo]`, `[Unsubscribe]`).
const BRACKET_LABEL_PATTERN = /\[([^\]\n]{0,80})\](?!\()/g
const EMPTY_ANCHOR_PATTERN = /\(\s*#+\s*\)/g

// Bare URLs contribute nothing to a preview ("view in browser" templates). We
// deliberately stop the match at any closing bracket / paren / quote so that
// URLs wrapped in `(...)`, `[...]`, `{...}`, `"..."` leave a balanced
// delimiter pair behind, which the empty-delimiter sweep below collapses
// cleanly. Quotes are included because marketing emails frequently embed
// URL-encoded JSON in tracking links (`?x=%7B"k":"v"%7D`) — without stopping
// at `"` the regex greedily eats the surrounding template markup and leaves a
// stray `}` orphan behind.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"]+/gi

// Empty balanced delimiters left over after URL / label stripping: `( )`,
// `[ ]`, `{ }`. These are pure visual noise in a preview line.
const EMPTY_DELIMITER_PAIR_PATTERN = /\(\s*\)|\[\s*\]|\{\s*\}/g

// A lone `{`, `}`, `"` surrounded by whitespace (or sitting at the string
// edges) is the residue of a URL-encoded JSON literal whose URL segments were
// just stripped — it is never useful prose, so we collapse it to a space.
const ORPHAN_SYMBOL_PATTERN = /(^|\s)[{}"]+(?=\s|$)/g

// Leading orphan punctuation (e.g. `. You were found by …` after a leading
// URL was stripped from `https://… .`) should be trimmed — the dot no longer
// belongs to any preceding word.
const LEADING_PUNCTUATION_PATTERN = /^[\s.!?:;,·•\-–—]+/

// Newsletter-style decorative marker at the very start: `96*`, `#42`, `[12]` —
// a short numeric / alphanumeric token fused to a decorative symbol, with no
// letters of its own. Requires at least one decorative symbol so we do not
// eat legitimate leading digits (e.g. "96 hours from now …").
const LEADING_DECORATIVE_TOKEN_PATTERN = /^(?:\d+[*~=_#\-]+|[#*~=_-]+\d+)\s*/

// Image / asset placeholder prefixes that various html-to-text converters
// (mailparser's own, the default for marketing senders) emit when an <img>
// carries an `alt` attribute: `image: Google Logo …`, `logo: Acme …`. The
// visible noun is filler for a preview — the actual message starts after it.
// Accept both `image: Google …` (colon form) and `img Ciao …` (bare noun form)
// — html-to-text converters produce both depending on how the `<img>` attrs
// were arranged in the source.
const LEADING_ASSET_LABEL_PATTERN = /^(?:image|img|picture|logo|icon|avatar|photo)(?:\s*:\s*|\s+)/i

// Pseudo-URLs in the form `<mailto:you@example.com>` or `<tel:+39…>` are a
// common artefact of html-to-text conversion — the anchor's href gets
// emitted inline as `<href> label`. The outer `<…>` remains after tag
// stripping because it lives inside the already-plain-text source.
const EMBEDDED_PROTOCOL_URI_PATTERN = /<(?:mailto|tel|sms|callto|skype):[^>]*>/gi

// Marketing senders sometimes ship a malformed email whose text/plain part
// includes the <style> block verbatim (mailparser fails to strip it). Catch
// the two concrete shapes that leak:
//   body, table, td { font-family: Arial; … }     — a full selector { rules }
//   font-family: Arial !important;                 — a bare property line
// The selector list is bounded at 200 chars to prevent catastrophic backtracks.
const CSS_RULE_BLOCK_PATTERN = /[^{}]{0,200}\{[^{}]*\}/g
const CSS_PROPERTY_LINE_PATTERN =
  /\b[a-z-]{2,32}\s*:\s*[^;{}\n]{1,120}!important\s*;?/gi

// CSS `@media` / `@supports` / `@container` / `@document` preludes that leak
// when the source byte cap sliced a <style> block mid-rule and the outer
// at-rule prelude survived without its `{ … }` body. We recognise them by
// the always-present parenthesised feature query (`(max-width: 480px)`,
// `(prefers-color-scheme: dark)`, …) — prose never has that shape, and a
// `mailto:` / `tel:` URI or an email address doesn't either, so this is
// specific enough to avoid eating legitimate content.
const CSS_MEDIA_QUERY_PATTERN =
  /@(?:media|supports|container|document)\b[^@{};\n]{0,120}\([^()@{};\n]{1,120}\)/gi

// Decorative separators: 2+ of `* _ = ~`, 3+ of `-`, 3+ of `.`, runs of dots
// (including the single-char ellipsis), and common bullet / geometric shapes.
const DECORATIVE_RUN_PATTERN = /[*_=~]{2,}|-{3,}|\.{3,}|[·•◦▪▫…]+/g

// Zero-width, bidi-control and word-joiner characters. Marketing senders rely
// on U+034F (combining grapheme joiner), zero-width spaces, and the
// soft-hyphen U+00AD to inject an invisible pre-header that only shows up in
// Gmail's inbox glance — a human never sees them, so they are pure noise for
// us.
const INVISIBLE_CHAR_PATTERN = /[­͏​-‏‪-‮⁠-⁯﻿]/g

// Standalone single decorative symbols (an isolated `*`, `~`, `=`, `_` that
// wasn't caught by `DECORATIVE_RUN_PATTERN` because it had no neighbours) —
// e.g. the `96*` newsletter marker in Bolt Food emails. Requires the symbol
// to be surrounded by whitespace/string edge so we don't break real words.
const STANDALONE_DECORATIVE_SYMBOL_PATTERN = /(^|\s)[*~=_]+(?=\s|$)/g

// HTML tag sliced mid-attribute by preview truncation (e.g. `<html xmlns="...`).
// Without this we would leak a stray `<html xmlns="...` into the new preview
// when re-parsing stale 200-char rows from the database.
const TRUNCATED_OPEN_TAG_TAIL_PATTERN = /<[a-z!?/][^<>]*$/i

// Dangling single-character delimiters that survive as garbage after URL and
// bracket stripping (a trailing lone `[`, `(`, `]`, slashes, pipes, ...).
const DANGLING_DELIMITER_TRAIL_PATTERN = /[\s]*[[\](){}<>|/\\]+\s*$/
const DANGLING_DELIMITER_LEAD_PATTERN = /^\s*[[\](){}<>|/\\]+\s+/

// Unclosed trailing `[something` produced by 200-char truncation (a bracket
// whose closing `]` fell past the preview limit).
const UNCLOSED_BRACKET_TAIL_PATTERN = /\s*\[[^\]\n]*$/

// Incomplete URL prefix left over when a URL got truncated before `://...` ran
// out of room inside the preview (e.g. `... [http` or `... https:/`).
const TRUNCATED_URL_TAIL_PATTERN = /\s*\b(?:https?:?\/*|www\.)\w*$/i

// Labels whose content is itself a URL or an image resource path carry no
// value as a preview — drop the whole `[label]` instead of keeping the URL.
const URL_LIKE_LABEL_PATTERN = /^(?:https?:|www\.)|\.(?:png|jpe?g|gif|svg|webp|bmp|tif[f]?)(?:[?#]|$)/i

// Latin + extended Latin + Greek + Cyrillic word characters of length ≥ 3.
// Used only to assess whether a candidate string carries enough real content.
const MEANINGFUL_WORD_PATTERN = /[A-Za-zÀ-ÿͰ-ϿЀ-ӿ]{3,}/g

const MIN_MEANINGFUL_WORDS_FOR_TEXT = 4

function collapseWhitespace(value: string): string {
  return value
    .replace(INVISIBLE_CHAR_PATTERN, '')
    .replace(/[\s ]+/g, ' ')
    .trim()
}

function stripQuotedBlocks(text: string): string {
  const lines = text.split(/\r?\n/)
  const result: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s+/, '')

    if (line.startsWith('>')) {
      continue
    }

    if (QUOTED_ATTRIBUTION_REGEX.test(line)) {
      if (result.some((entry) => entry.trim().length > 0)) {
        break
      }

      continue
    }

    result.push(rawLine)
  }

  return result.join('\n')
}

function decodeNumericEntity(code: string, radix: number): string {
  const parsed = Number.parseInt(code, radix)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) {
    return ' '
  }
  try {
    return String.fromCodePoint(parsed)
  } catch {
    return ' '
  }
}

// Common HTML named entities that appear in email bodies. Zero-width entities
// (`zwnj`, `zwj`, `shy`, `lrm`, `rlm`) collapse to empty — they are the HTML
// cousins of the invisible pre-header characters stripped elsewhere. Unknown
// entities are left untouched rather than replaced with a question mark, since
// the goal here is clean preview text, not faithful rendering.
const NAMED_ENTITY_TABLE: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  zwnj: '',
  zwj: '',
  shy: '',
  lrm: '',
  rlm: '',
  thinsp: ' ',
  hairsp: ' ',
  ensp: ' ',
  emsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  bdquo: '„',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  iexcl: '¡',
  iquest: '¿'
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
      const replacement = NAMED_ENTITY_TABLE[name.toLowerCase()]
      return replacement !== undefined ? replacement : match
    })
    .replace(/&#(\d+);/g, (_match, code: string) => decodeNumericEntity(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => decodeNumericEntity(code, 16))
    // An entity whose closing `;` was sliced off by truncation leaks as
    // literal `&zwn`, `&am`, `&#34` etc. Trim that tail so it doesn't hit
    // the preview as visible garbage.
    .replace(/&#?[a-zA-Z0-9]{0,9}$/, '')
}

// Pragmatic HTML-to-text for preview generation. We don't need a full DOM: we
// only need to kill non-content blocks, preserve paragraph boundaries, strip
// the rest, and decode entities. Anything fancier is left to the iframe
// renderer downstream.
function stripHtmlForPreview(html: string): string {
  const withoutChrome = html
    .replace(/<!DOCTYPE[^>]*>/gi, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Truncated counterparts: when the preview byte cap slices the raw source
    // in the middle of <head> or <style>, the closing tag never arrives in our
    // window. Without this fallback, everything from the unclosed tag onward
    // (typically ~10 KB of @media queries) leaks into the preview as text.
    // Strip `<head>` / `<style>` / `<script>` ... and everything after them to
    // the end of the string in that case.
    .replace(/<(head|script|style|noscript|template|svg|title)\b[^>]*>[\s\S]*$/i, ' ')

  const withBlockBoundaries = withoutChrome
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(?:p|div|li|tr|td|th|h[1-6]|blockquote|section|article|header|footer)>/gi,
      '\n'
    )

  const stripped = withBlockBoundaries
    .replace(/<[^>]+>/g, ' ')
    // Handle a tag that was truncated mid-attribute (no closing `>`) — this
    // happens when we re-parse stale 200-char DB rows or when an email body
    // itself is clipped by the upstream byte cap.
    .replace(TRUNCATED_OPEN_TAG_TAIL_PATTERN, ' ')
  return decodeBasicEntities(stripped)
}

function scrubPromotionalNoise(text: string): string {
  return text
    // Clean up malformed CSS that leaked into the plain-text alternative
    // BEFORE touching anything else — if we strip URLs first we change char
    // offsets and the CSS-block regex can fail to match reliably.
    // Bare `@media (…)` / `@supports (…)` preludes that outlived the `{ … }`
    // block stripper because the source was truncated mid-rule run first — if
    // we let URL/bracket cleaners go before them, `(max-width:480px)` inside
    // the media query prelude would lose its parenthesised anchor.
    .replace(CSS_MEDIA_QUERY_PATTERN, ' ')
    .replace(CSS_RULE_BLOCK_PATTERN, ' ')
    .replace(CSS_PROPERTY_LINE_PATTERN, ' ')
    // `<mailto:…>` / `<tel:…>` style pseudo-tags left over by html-to-text
    // conversions — they survive our HTML stripper because they originate
    // inside the already-plain-text source.
    .replace(EMBEDDED_PROTOCOL_URI_PATTERN, ' ')
    .replace(MARKDOWN_LINK_PATTERN, (_match, label: string) => {
      const cleaned = label.trim()
      if (!cleaned || cleaned === '#') return ' '
      // `[https://cdn.example/logo.png](link)` — the visible label is an image
      // URL / asset path, which contributes nothing to a preview; drop entirely.
      if (URL_LIKE_LABEL_PATTERN.test(cleaned)) return ' '
      return cleaned
    })
    .replace(TRUNCATED_MARKDOWN_LINK_TAIL_PATTERN, ' ')
    .replace(BRACKET_LABEL_PATTERN, (_match, label: string) => {
      const cleaned = label.trim()
      if (!cleaned) return ' '
      if (URL_LIKE_LABEL_PATTERN.test(cleaned)) return ' '
      return cleaned
    })
    .replace(EMPTY_ANCHOR_PATTERN, ' ')
    .replace(URL_PATTERN, ' ')
    .replace(TRUNCATED_URL_TAIL_PATTERN, ' ')
    .replace(UNCLOSED_BRACKET_TAIL_PATTERN, ' ')
    .replace(DECORATIVE_RUN_PATTERN, ' ')
    .replace(STANDALONE_DECORATIVE_SYMBOL_PATTERN, '$1 ')
    // After URLs / labels have been stripped, balanced delimiters are often
    // left empty (e.g. `(  )` from `(https://example.com)`). Kill them before
    // they reach the reader.
    .replace(EMPTY_DELIMITER_PAIR_PATTERN, ' ')
    // URL-encoded JSON payloads sometimes contain literal `{` / `}` / `"`;
    // once the URL half is stripped the surviving orphan stands on its own
    // surrounded by whitespace. Those are never content.
    .replace(ORPHAN_SYMBOL_PATTERN, '$1 ')
}

function countMeaningfulWords(cleanedText: string): number {
  const matches = cleanedText.match(MEANINGFUL_WORD_PATTERN)
  return matches?.length ?? 0
}

function trimDanglingDelimiters(value: string): string {
  let current = value
  let previous: string

  do {
    previous = current
    current = current
      .replace(DANGLING_DELIMITER_TRAIL_PATTERN, '')
      .replace(DANGLING_DELIMITER_LEAD_PATTERN, '')
      .trim()
  } while (current !== previous)

  return current
}

function cleanCandidate(raw: string): string {
  // Named / numeric entities can show up in either source: obviously in HTML
  // (which we already strip via `stripHtmlForPreview`) but also in text/plain
  // alternatives that were themselves machine-converted from HTML. Always
  // decoding here guarantees a `&zwnj;` / `&copy;` sequence never leaks into
  // a final preview regardless of where it came from.
  const decoded = decodeBasicEntities(raw)
  const dequoted = stripQuotedBlocks(decoded)
  const scrubbed = scrubPromotionalNoise(dequoted)
  const collapsed = collapseWhitespace(scrubbed)
  const trimmed = trimDanglingDelimiters(collapsed)
  return trimmed
    .replace(LEADING_ASSET_LABEL_PATTERN, '')
    .replace(LEADING_DECORATIVE_TOKEN_PATTERN, '')
    .replace(LEADING_PUNCTUATION_PATTERN, '')
}

function removeLeadingSubject(body: string, subject: string): string {
  const normalizedSubject = collapseWhitespace(subject).toLowerCase()
  if (!normalizedSubject) {
    return body
  }

  if (!body.toLowerCase().startsWith(normalizedSubject)) {
    return body
  }

  const rest = body
    .slice(normalizedSubject.length)
    .replace(/^[\s\-—–:|)\]]+/, '')
    .trimStart()
  return rest || body
}

function finalizePreview(candidate: string, subject: string): string {
  const fallbackSubject = subject.trim() || '(Senza oggetto)'

  if (!candidate) {
    return fallbackSubject
  }

  const withoutSubject = removeLeadingSubject(candidate, subject).slice(0, PREVIEW_MAX_LENGTH)

  // If the cleanup wiped out every meaningful word (only punctuation / scraps
  // left), the preview is worse than the subject — show the subject instead.
  if (countMeaningfulWords(withoutSubject) === 0) {
    return fallbackSubject
  }

  return withoutSubject
}

// Marker phrases that reliably identify a plain-text alternative produced by
// an email-marketing template rather than the sender's actual copy. When the
// text candidate opens with any of these we skip it and prefer the HTML body
// (which typically contains the real message). Matched against the first few
// hundred characters only, so running cost is O(1) per email.
const TEMPLATE_BOILERPLATE_PATTERNS: RegExp[] = [
  /email\s+client\s+(?:might|may|does)\s+not\s+support\s+html/i,
  /(?:can'?t|cannot|unable\s+to)\s+(?:see|view|read|display)\s+(?:this\s+)?(?:email|message)/i,
  /view\s+(?:this\s+)?(?:email|message|newsletter|mail)\s+(?:in\s+(?:your\s+)?(?:browser|web\s+browser)|online)/i,
  /email\s+not\s+displaying\s+correctly/i,
  /this\s+email\s+was\s+sent\s+to\s+you\s+as\s+html-only/i,
  /having\s+trouble\s+(?:viewing|reading|displaying)/i,
  /if\s+(?:you\s+are\s+)?(?:having\s+trouble|unable)\s+(?:to\s+)?(?:see|view|read|display)/i,
  /(?:^|\n)\s*subject\s*line\s*:/i,
  /(?:^|\n)\s*preheader\s*:/i,
  /se\s+non\s+(?:visualizzi|riesci\s+a\s+visualizzare|vedi)\s+(?:correttamente\s+)?(?:questa\s+)?(?:mail|email|messaggio)/i,
  /si\s+(?:prega|invita)\s+di\s+(?:aprire|visualizzare)\s+(?:questa\s+)?email/i
]

function looksLikeTemplateBoilerplate(text: string): boolean {
  const head = text.slice(0, 400)
  return TEMPLATE_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(head))
}

function pickBestCandidate(parsed: ParsedMail): string {
  const textSource = typeof parsed.text === 'string' ? parsed.text : ''
  const textCandidate = textSource ? cleanCandidate(textSource) : ''
  const textWordCount = countMeaningfulWords(textCandidate)
  const textIsBoilerplate = Boolean(textSource) && looksLikeTemplateBoilerplate(textSource)

  if (textWordCount >= MIN_MEANINGFUL_WORDS_FOR_TEXT && !textIsBoilerplate) {
    return textCandidate
  }

  const htmlSource = typeof parsed.html === 'string' ? parsed.html : ''
  const htmlCandidate = htmlSource ? cleanCandidate(stripHtmlForPreview(htmlSource)) : ''
  const htmlWordCount = countMeaningfulWords(htmlCandidate)

  // A boilerplate text candidate is never acceptable — prefer HTML if it
  // carries real prose, otherwise return empty so `finalizePreview` falls back
  // to the subject (which at least is the sender's own words).
  if (textIsBoilerplate) {
    return htmlWordCount >= MIN_MEANINGFUL_WORDS_FOR_TEXT ? htmlCandidate : ''
  }

  if (!htmlSource) {
    return textCandidate
  }

  return htmlWordCount > textWordCount ? htmlCandidate : textCandidate || htmlCandidate
}

export async function parseMessagePayload(source: Buffer | string): Promise<ParsedMail> {
  return simpleParser(source, {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true
  })
}

export function extractPreview(parsed: ParsedMail, subject: string): string {
  return finalizePreview(pickBestCandidate(parsed), subject)
}
