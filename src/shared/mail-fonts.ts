/**
 * Font stacks offered in the composer and used by authored mail.
 *
 * Email is not the web: virtually every client strips `@font-face`, so a
 * font only renders if the *recipient* already has it installed. SIEVER's
 * house font, Century Gothic, ships with Microsoft Office on Windows but
 * exists nowhere on macOS, on Linux, or in Gmail's web client — which is
 * exactly why messages that look right in-house arrive at customers in
 * plain Arial.
 *
 * The fix is not to change the font, it is to give every option a real
 * fallback chain: the house font first (so nothing changes for anyone who
 * has it), then the closest face that actually ships on each other
 * platform, then a generic. Century Gothic therefore falls back to Futura
 * on macOS and URW Gothic on Linux — all three are geometric sans faces
 * from the same Avant Garde lineage, so the message keeps its identity
 * instead of collapsing to Arial.
 *
 * SIEVER Mail itself bundles Century Gothic as a webfont (see
 * `MAIL_FRAME_BASELINE_CSS`), so in-app rendering stays pixel-identical on
 * every platform regardless of what is installed.
 *
 * Every stack below follows the same rule: Windows face → macOS
 * equivalent → free metric-compatible clone for Linux → generic family.
 */

export interface MailFontOption {
  label: string
  value: string
}

/**
 * SIEVER's house font. Windows/Office resolves Century Gothic itself;
 * macOS lands on Futura and Linux on URW Gothic, both geometric sans faces
 * with near-identical proportions. Trebuchet MS is the last humanist stop
 * before the generic fallback.
 */
export const MAIL_EDITOR_DEFAULT_FONT_FAMILY =
  "'Century Gothic', Futura, 'URW Gothic', 'Avant Garde', 'Trebuchet MS', Arial, sans-serif"
export const MAIL_COMPOSER_DEFAULT_FONT_FAMILY = MAIL_EDITOR_DEFAULT_FONT_FAMILY
export const MAIL_COMPOSER_SIGNATURE_SEPARATOR_HTML = ''

/**
 * Stack for the emoji glyphs used in the signature blocks. Windows ships
 * Segoe UI Emoji, macOS/iOS Apple Color Emoji, most Linux distributions
 * Noto Color Emoji — without all three, one platform renders tofu.
 */
export const MAIL_EMOJI_FONT_FAMILY =
  "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif"

/**
 * Display face used for the SIEVER wordmark in the corporate signature.
 * Lucida Sans Unicode is the Windows name, Lucida Grande the macOS one for
 * the same family; DejaVu Sans is its usual Linux stand-in.
 */
export const MAIL_WORDMARK_FONT_FAMILY =
  "'Lucida Sans Unicode', 'Lucida Grande', 'DejaVu Sans', Verdana, sans-serif"

export const MAIL_FONT_OPTIONS: readonly MailFontOption[] = [
  { label: 'Century Gothic', value: MAIL_EDITOR_DEFAULT_FONT_FAMILY },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Arial Black', value: "'Arial Black', Gadget, Impact, sans-serif" },
  { label: 'Arial Narrow', value: "'Arial Narrow', 'Helvetica Neue Condensed', Arial, sans-serif" },
  // Calibri and Cambria are Office fonts with no macOS counterpart; Carlito
  // and Caladea are their metric-compatible free clones, common on Linux.
  { label: 'Calibri', value: "Calibri, Carlito, 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Candara', value: "Candara, Optima, 'Trebuchet MS', sans-serif" },
  { label: 'Corbel', value: "Corbel, 'Lucida Grande', 'Lucida Sans Unicode', Verdana, sans-serif" },
  { label: 'Helvetica', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  {
    label: 'Franklin Gothic',
    value: "'Franklin Gothic Medium', 'Arial Narrow', Arial, Helvetica, sans-serif"
  },
  { label: 'Impact', value: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { label: 'Lucida Sans', value: MAIL_WORDMARK_FONT_FAMILY },
  // Segoe UI is Windows-only; on macOS the nearest shipped UI face is
  // Helvetica Neue, and Linux almost always has DejaVu Sans.
  { label: 'Segoe UI', value: "'Segoe UI', 'Helvetica Neue', 'DejaVu Sans', Tahoma, sans-serif" },
  { label: 'Tahoma', value: 'Tahoma, Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', 'Lucida Grande', Helvetica, sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, DejaVu Sans, sans-serif' },
  { label: 'Comic Sans MS', value: "'Comic Sans MS', 'Chalkboard SE', 'Comic Neue', cursive" },
  { label: 'Book Antiqua', value: "'Book Antiqua', 'Palatino Linotype', Palatino, Georgia, serif" },
  { label: 'Cambria', value: "Cambria, Caladea, Georgia, 'Times New Roman', serif" },
  { label: 'Constantia', value: "Constantia, 'Palatino Linotype', Palatino, Georgia, serif" },
  { label: 'Garamond', value: "Garamond, 'EB Garamond', 'Palatino Linotype', Palatino, serif" },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', Times, serif" },
  { label: 'Palatino', value: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, 'Liberation Serif', serif" },
  { label: 'Consolas', value: "Consolas, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace" },
  { label: 'Courier New', value: "'Courier New', Courier, 'Liberation Mono', monospace" },
  { label: 'Lucida Console', value: "'Lucida Console', Monaco, 'DejaVu Sans Mono', monospace" }
] as const

export function normalizeMailFontFamilyValue(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const sanitizedParts: string[] = []

  for (const part of parts) {
    const unquoted = part.replace(/^['"]+|['"]+$/g, '').trim()

    if (
      !unquoted ||
      /(?:url\s*\(|expression\s*\(|[<>;{}])/i.test(unquoted) ||
      !/^[a-z0-9 ._+-]+$/i.test(unquoted)
    ) {
      continue
    }

    sanitizedParts.push(/\s/.test(unquoted) ? `'${unquoted}'` : unquoted)
  }

  return sanitizedParts.length > 0 ? sanitizedParts.join(', ') : null
}

export function getPrimaryMailFontFamily(value: string | null | undefined): string | null {
  const normalized = normalizeMailFontFamilyValue(value)

  if (!normalized) {
    return null
  }

  const primary = normalized.split(',')[0]?.trim() ?? ''
  return (
    primary
      .replace(/^['"]+|['"]+$/g, '')
      .trim()
      .toLowerCase() || null
  )
}

export function getDisplayMailFontFamily(value: string | null | undefined): string | null {
  const normalized = normalizeMailFontFamilyValue(value)

  if (!normalized) {
    return null
  }

  const primary = normalized.split(',')[0]?.trim() ?? ''
  return primary.replace(/^['"]+|['"]+$/g, '').trim() || null
}

export function areMailFontFamiliesEquivalent(
  firstValue: string | null | undefined,
  secondValue: string | null | undefined
): boolean {
  const firstPrimary = getPrimaryMailFontFamily(firstValue)
  const secondPrimary = getPrimaryMailFontFamily(secondValue)

  if (!firstPrimary || !secondPrimary) {
    return false
  }

  return firstPrimary === secondPrimary
}

export function findMailFontOption(value: string | null | undefined): MailFontOption | null {
  const normalized = normalizeMailFontFamilyValue(value)

  if (!normalized) {
    return null
  }

  return (
    MAIL_FONT_OPTIONS.find((option) => {
      const normalizedOptionValue = normalizeMailFontFamilyValue(option.value)

      return (
        normalizedOptionValue === normalized ||
        areMailFontFamiliesEquivalent(option.value, normalized)
      )
    }) ?? null
  )
}
