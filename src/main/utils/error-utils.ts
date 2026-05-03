type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike }

const SENSITIVE_KEY_PATTERN = /(pass|password|secret|token|authorization|cookie|oauth|refresh)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toPrimitive(value: unknown): JsonLike {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (value === null || value === undefined) {
    return null
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return String(value)
}

export function sanitizeForLog(value: unknown, depth = 0): JsonLike {
  if (depth > 6) {
    return '[Truncated]'
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1))
  }

  if (isRecord(value)) {
    const sanitizedEntries = Object.entries(value).map(([key, currentValue]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[REDACTED]']
      }

      return [key, sanitizeForLog(currentValue, depth + 1)]
    })

    return Object.fromEntries(sanitizedEntries) as { [key: string]: JsonLike }
  }

  return toPrimitive(value)
}

export interface ErrorDetails {
  name: string
  message: string
  code?: string
  response?: string
  responseStatus?: string
  responseText?: string
  serverResponseCode?: string
  executedCommand?: string
  command?: string
  authenticationFailed?: boolean
}

export function extractErrorDetails(error: unknown): ErrorDetails {
  if (!isRecord(error)) {
    return {
      name: 'Error',
      message: typeof error === 'string' ? error : 'Unknown error'
    }
  }

  const message = typeof error.message === 'string' ? error.message : 'Unknown error'
  const name = typeof error.name === 'string' ? error.name : 'Error'

  return {
    name,
    message,
    code: typeof error.code === 'string' ? error.code : undefined,
    response: typeof error.response === 'string' ? error.response : undefined,
    responseStatus: typeof error.responseStatus === 'string' ? error.responseStatus : undefined,
    responseText: typeof error.responseText === 'string' ? error.responseText : undefined,
    serverResponseCode:
      typeof error.serverResponseCode === 'string' ? error.serverResponseCode : undefined,
    executedCommand: typeof error.executedCommand === 'string' ? error.executedCommand : undefined,
    command: typeof error.command === 'string' ? error.command : undefined,
    authenticationFailed:
      typeof error.authenticationFailed === 'boolean' ? error.authenticationFailed : undefined
  }
}

export function logMainError(context: string, error: unknown, meta?: unknown): void {
  const details = extractErrorDetails(error)

  console.error(`[main:error] ${context}`, {
    error: sanitizeForLog(details),
    meta: sanitizeForLog(meta)
  })
}
