import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { BrowserWindow } from 'electron'
import { google } from 'googleapis'

import type { RuntimeConfig } from '@main/config/env'

interface GoogleAuthResult {
  email: string
  displayName: string
  refreshToken: string
}

const GOOGLE_SCOPES = ['https://mail.google.com/', 'openid', 'email', 'profile']

function callbackResponseHtml(success: boolean): string {
  const title = success ? 'Accesso completato' : 'Accesso non riuscito'
  const body = success
    ? 'Puoi chiudere questa finestra e tornare al client email.'
    : 'Autorizzazione annullata o non valida. Puoi chiudere questa finestra.'

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:system-ui;padding:24px;background:#101421;color:#f1f5f9"><h2>${title}</h2><p>${body}</p></body></html>`
}

export class GoogleOAuthService {
  private readonly clientId?: string
  private readonly clientSecret?: string

  constructor(config: RuntimeConfig) {
    this.clientId = config.googleClientId
    this.clientSecret = config.googleClientSecret
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret)
  }

  async authorize(parentWindow?: BrowserWindow): Promise<GoogleAuthResult> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.'
      )
    }

    const server = createServer()

    const callbackDataPromise = new Promise<string>((resolve, reject) => {
      server.on('request', (request, response) => {
        const requestUrl = request.url

        if (!requestUrl) {
          response.statusCode = 400
          response.end(callbackResponseHtml(false))
          return
        }

        const url = new URL(requestUrl, 'http://127.0.0.1')

        if (url.pathname !== '/oauth2callback') {
          response.statusCode = 404
          response.end('Not Found')
          return
        }

        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')

        if (error || !code) {
          response.statusCode = 400
          response.setHeader('content-type', 'text/html; charset=utf-8')
          response.end(callbackResponseHtml(false))
          reject(
            new Error(
              error ? `Google OAuth error: ${error}` : 'Missing OAuth code from Google callback.'
            )
          )
          return
        }

        response.statusCode = 200
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(callbackResponseHtml(true))
        resolve(code)
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })

    const serverAddress = server.address()

    if (!serverAddress || typeof serverAddress === 'string') {
      server.close()
      throw new Error('Unable to start local OAuth callback server.')
    }

    const redirectUri = `http://127.0.0.1:${(serverAddress as AddressInfo).port}/oauth2callback`

    const oauthClient = new google.auth.OAuth2(this.clientId, this.clientSecret, redirectUri)

    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES
    })

    const authWindow = new BrowserWindow({
      title: 'Accedi con Google',
      width: 560,
      height: 760,
      parent: parentWindow,
      modal: Boolean(parentWindow),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    const cancelPromise = new Promise<never>((_, reject) => {
      authWindow.on('closed', () => reject(new Error('Google OAuth flow cancelled by user.')))
    })

    try {
      await authWindow.loadURL(authUrl)
      const code = await Promise.race([callbackDataPromise, cancelPromise])
      const { tokens } = await oauthClient.getToken(code)

      if (!tokens.refresh_token) {
        throw new Error(
          'Google OAuth did not return a refresh token. Ensure prompt=consent and offline access.'
        )
      }

      oauthClient.setCredentials(tokens)

      const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient })
      const profile = await oauth2.userinfo.get()

      const email = profile.data.email

      if (!email) {
        throw new Error('Google account email not available from OAuth profile.')
      }

      return {
        email,
        displayName: profile.data.name || email,
        refreshToken: tokens.refresh_token
      }
    } finally {
      if (!authWindow.isDestroyed()) {
        authWindow.close()
      }

      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }

  async getAccessToken(refreshToken: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.'
      )
    }

    const oauthClient = new google.auth.OAuth2(this.clientId, this.clientSecret)
    oauthClient.setCredentials({ refresh_token: refreshToken })

    const token = await oauthClient.getAccessToken()

    if (!token.token) {
      throw new Error('Unable to mint Google access token from refresh token.')
    }

    return token.token
  }
}
