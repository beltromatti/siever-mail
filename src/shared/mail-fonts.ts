/**
 * Font stacks offered in the composer and used by authored mail.
 *
 * Email is not the web: virtually every client strips `@font-face`, so a
 * font only renders if the *recipient* already has it installed. A face
 * that ships with Office on Windows exists nowhere on macOS, on Linux or in
 * Gmail's web client — which is how a message that looks right at the
 * sender's desk arrives in plain Arial.
 *
 * So every option is a real fallback chain, following one rule: Windows
 * face → macOS equivalent → free metric-compatible clone for Linux →
 * generic family. A message keeps its character wherever it is read
 * instead of collapsing to the reader's default.
 *
 * An extension can offer fonts of its own ahead of these and set the one
 * new text starts in (see `ExtensionComposition`); the public build starts
 * in Arial, the one face every platform actually ships.
 */
import composition from '@app/extension/shared'

export interface MailFontOption {
  label: string
  value: string
}

const ARIAL_FONT_FAMILY = 'Arial, Helvetica, sans-serif'

/** The stack new text starts in. */
export const MAIL_EDITOR_DEFAULT_FONT_FAMILY = composition.defaultFontFamily ?? ARIAL_FONT_FAMILY
export const MAIL_COMPOSER_DEFAULT_FONT_FAMILY = MAIL_EDITOR_DEFAULT_FONT_FAMILY
export const MAIL_COMPOSER_SIGNATURE_SEPARATOR_HTML = ''

/**
 * Stack for emoji glyphs. Windows ships Segoe UI Emoji, macOS/iOS Apple
 * Color Emoji, most Linux distributions Noto Color Emoji — without all
 * three, one platform renders tofu.
 */
export const MAIL_EMOJI_FONT_FAMILY =
  "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif"

const HOST_FONT_OPTIONS: readonly MailFontOption[] = [
  { label: 'Arial', value: ARIAL_FONT_FAMILY },
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
  // Lucida Sans Unicode is the Windows name, Lucida Grande the macOS one for
  // the same family; DejaVu Sans is its usual Linux stand-in.
  {
    label: 'Lucida Sans',
    value: "'Lucida Sans Unicode', 'Lucida Grande', 'DejaVu Sans', Verdana, sans-serif"
  },
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
]

/** The font menu: the extension's fonts first, then the host's. */
export const MAIL_FONT_OPTIONS: readonly MailFontOption[] = [
  ...composition.fonts,
  ...HOST_FONT_OPTIONS.filter(
    (option) => !composition.fonts.some((font) => font.label === option.label)
  )
]

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

/**
 * Every stack this app authors, indexed by its primary family: the menu,
 * the emoji stack and whatever the extension's own content uses.
 */
const CANONICAL_STACKS_BY_PRIMARY: ReadonlyMap<string, string> = new Map(
  [
    ...MAIL_FONT_OPTIONS.map((option) => option.value),
    MAIL_EMOJI_FONT_FAMILY,
    ...composition.extraFontStacks
  ]
    .map((stack) => [getPrimaryMailFontFamily(stack), stack] as const)
    .filter((entry): entry is readonly [string, string] => entry[0] !== null)
)

const FONT_FAMILY_DECLARATION_PATTERN = /font-family\s*:\s*([^;"}]+)/gi

/**
 * Rewrites every font-family declaration whose primary family is one of ours
 * to that family's full fallback chain.
 *
 * Content written before the chains existed carries a face followed by a
 * bare generic — `'Lucida Sans Unicode', sans-serif`. That reads as the
 * face only where it is installed, and as Helvetica or Arial everywhere
 * else. The chains put the closest face each platform actually ships in
 * between, so the message keeps its identity instead of collapsing.
 *
 * Only declarations we recognise are touched, and a stack that already is
 * the canonical one is left byte-identical, so this is safe to run over the
 * same HTML repeatedly.
 */
export function upgradeMailFontStacksInHtml(html: string): string {
  if (!html) {
    return html
  }

  return html.replace(FONT_FAMILY_DECLARATION_PATTERN, (declaration, value: string) => {
    const primary = getPrimaryMailFontFamily(value)
    const canonical = primary ? CANONICAL_STACKS_BY_PRIMARY.get(primary) : undefined

    if (!canonical || normalizeMailFontFamilyValue(value) === canonical) {
      return declaration
    }

    // Keep whatever trailing whitespace the author had, so the only
    // difference in the stored HTML is the list of families itself.
    const trailingWhitespace = value.match(/\s*$/)?.[0] ?? ''
    return `${declaration.slice(0, declaration.length - value.length)}${canonical}${trailingWhitespace}`
  })
}
