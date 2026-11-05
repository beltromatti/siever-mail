import { z } from 'zod'

const envSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().trim().min(1).optional(),
  /** The app registered in Microsoft Entra (public client, redirect `http://localhost`). */
  MICROSOFT_OAUTH_CLIENT_ID: z.string().trim().min(1).optional()
})

export interface RuntimeConfig {
  googleClientId?: string
  googleClientSecret?: string
  microsoftClientId?: string
}

export function loadRuntimeConfig(): RuntimeConfig {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    return {}
  }

  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, MICROSOFT_OAUTH_CLIENT_ID } =
    parsed.data

  return {
    ...(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET
      ? { googleClientId: GOOGLE_OAUTH_CLIENT_ID, googleClientSecret: GOOGLE_OAUTH_CLIENT_SECRET }
      : {}),
    ...(MICROSOFT_OAUTH_CLIENT_ID ? { microsoftClientId: MICROSOFT_OAUTH_CLIENT_ID } : {})
  }
}
