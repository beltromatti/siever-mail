import { z } from 'zod'

/**
 * A variable with a value. Blank counts as not set — `KEY=` is how `.env.example`
 * and the release workflow write one they do not have — so one missing value
 * turns off its own sign-in, never the others.
 */
const setting = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional()
)

const envSchema = z.object({
  GOOGLE_OAUTH_CLIENT_ID: setting,
  GOOGLE_OAUTH_CLIENT_SECRET: setting,
  /** The app registered in Microsoft Entra (public client, redirect `http://localhost`). */
  MICROSOFT_OAUTH_CLIENT_ID: setting
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
