const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:'])

export function normalizeExternalHttpUrl(rawUrl: string): string | null {
  const value = rawUrl.trim()
  if (!value) {
    return null
  }

  try {
    const parsed = new URL(value)
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}
