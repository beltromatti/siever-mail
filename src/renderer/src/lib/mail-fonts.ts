export interface MailFontOption {
  label: string
  value: string
}

export const MAIL_EDITOR_DEFAULT_FONT_FAMILY = "'Century Gothic', Arial, sans-serif"
export const MAIL_COMPOSER_DEFAULT_FONT_FAMILY = MAIL_EDITOR_DEFAULT_FONT_FAMILY
export const MAIL_COMPOSER_SIGNATURE_SEPARATOR_HTML = ''

export const MAIL_FONT_OPTIONS: readonly MailFontOption[] = [
  { label: 'Century Gothic', value: MAIL_EDITOR_DEFAULT_FONT_FAMILY },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Arial Black', value: "'Arial Black', Arial, sans-serif" },
  { label: 'Calibri', value: 'Calibri, Helvetica, Arial, sans-serif' },
  { label: 'Candara', value: 'Candara, Trebuchet MS, Arial, sans-serif' },
  { label: 'Corbel', value: 'Corbel, Verdana, Arial, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Segoe UI', value: "'Segoe UI', Tahoma, sans-serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Lucida Sans', value: "'Lucida Sans Unicode', 'Lucida Grande', sans-serif" },
  { label: 'Comic Sans MS', value: "'Comic Sans MS', Arial, sans-serif" },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Franklin Gothic', value: "'Franklin Gothic Medium', Arial, Helvetica, sans-serif" },
  { label: 'Arial Narrow', value: "'Arial Narrow', Arial, sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, Times New Roman, serif' },
  { label: 'Book Antiqua', value: "'Book Antiqua', Georgia, serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Constantia', value: 'Constantia, Times New Roman, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Palatino', value: "'Palatino Linotype', Palatino, serif" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
  { label: 'Consolas', value: 'Consolas, "Lucida Console", Courier, monospace' },
  { label: 'Lucida Console', value: "'Lucida Console', Monaco, monospace" }
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
  return primary.replace(/^['"]+|['"]+$/g, '').trim().toLowerCase() || null
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

  return MAIL_FONT_OPTIONS.find((option) => {
    const normalizedOptionValue = normalizeMailFontFamilyValue(option.value)

    return normalizedOptionValue === normalized || areMailFontFamiliesEquivalent(option.value, normalized)
  }) ?? null
}
