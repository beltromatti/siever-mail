function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
