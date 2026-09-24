/**
 * Versions of the page a stored signature was written against.
 *
 *   1 — up to 1.8: the editor zeroed every paragraph's margins and gave any
 *       block without a line height of its own 1.5. Signatures looked
 *       compact in the app and arrived with the recipient's spacing.
 *   2 — the editor shows mail as any client would (see `mail-html.ts`);
 *       whatever a signature looks like is written on the signature itself.
 */
export const SIGNATURE_HTML_FORMAT = 2

const LEGACY_LINE_HEIGHT = '1.5'
const BLOCK_OPEN_TAG_PATTERN = /<(p|div)(\s[^>]*)?>/gi
const STYLE_ATTRIBUTE_PATTERN = /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i

function declares(style: string, property: string): boolean {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:`, 'i').test(style)
}

/**
 * Writes onto a format-1 signature what the old editor used to add behind
 * its back — margin 0 on paragraphs, line height 1.5 on blocks that set
 * none — so it keeps looking exactly as its owner designed it, now in the
 * message itself. Only opening `p` and `div` tags are touched, and only for
 * what they do not already declare.
 *
 * Works on the browser-serialised HTML the editor stores, where attribute
 * values are quoted and a style never contains `>`.
 */
export function upgradeLegacySignatureHtml(html: string): string {
  return html.replace(BLOCK_OPEN_TAG_PATTERN, (tag, name: string, rawAttributes?: string) => {
    const attributes = rawAttributes ?? ''
    const styleMatch = attributes.match(STYLE_ATTRIBUTE_PATTERN)
    const style = (styleMatch?.[3] ?? '').trim().replace(/;+$/, '')
    // The margin goes first, so a side the author did set (`margin-bottom`)
    // still wins over it, as it did over the old stylesheet rule.
    const leading = name.toLowerCase() === 'p' && !declares(style, 'margin') ? ['margin: 0'] : []
    const trailing = declares(style, 'line-height') ? [] : [`line-height: ${LEGACY_LINE_HEIGHT}`]

    if (leading.length === 0 && trailing.length === 0) {
      return tag
    }

    const nextStyle = [...leading, ...(style ? [style] : []), ...trailing].join('; ')

    if (!styleMatch) {
      return `<${name}${attributes} style="${nextStyle}">`
    }

    const [whole, prefix, quote] = styleMatch
    return `<${name}${attributes.replace(whole, `${prefix}${quote}${nextStyle}${quote}`)}>`
  })
}
