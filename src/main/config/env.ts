import { z } from 'zod'

const envSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().trim().min(1).optional()
})

export interface RuntimeConfig {
  googleClientId?: string
  googleClientSecret?: string
}

export function loadRuntimeConfig(): RuntimeConfig {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    return {}
  }

  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = parsed.data

  if (GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET) {
    return {
      googleClientId: GOOGLE_OAUTH_CLIENT_ID,
      googleClientSecret: GOOGLE_OAUTH_CLIENT_SECRET
    }
  }

  return {}
}
