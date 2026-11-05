import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadRuntimeConfig } from './env'

describe('loadRuntimeConfig', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('takes a blank variable as not set, and keeps the others', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'google-id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret')
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', '')

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'google-id',
      googleClientSecret: 'google-secret'
    })
  })

  it('reads every sign-in that is set', () => {
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_ID', 'google-id')
    vi.stubEnv('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret')
    vi.stubEnv('MICROSOFT_OAUTH_CLIENT_ID', ' ms-id ')

    expect(loadRuntimeConfig()).toEqual({
      googleClientId: 'google-id',
      googleClientSecret: 'google-secret',
      microsoftClientId: 'ms-id'
    })
  })
})
