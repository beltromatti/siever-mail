import { describe, expect, it } from 'vitest'

import { discoverMailSettings, parseAutoconfig, type DiscoveryDeps } from './mail-discovery'

const LIBERO_LIKE = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="studio.it">
    <domain>studio.it</domain>
    <displayName>Posta dello Studio</displayName>
    <incomingServer type="pop3">
      <hostname>pop.studio.it</hostname><port>995</port><socketType>SSL</socketType>
      <authentication>password-cleartext</authentication><username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.%EMAILDOMAIN%</hostname><port>993</port><socketType>SSL</socketType>
      <authentication>password-cleartext</authentication><username>%EMAILLOCALPART%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.studio.it</hostname><port>587</port><socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication><username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

/** A network and a DNS that answer only what a test gives them. */
function deps(world: {
  files?: Record<string, string>
  mx?: Record<string, string[]>
  srv?: Record<string, { name: string; port: number }>
  open?: string[]
}): DiscoveryDeps & { asked: string[] } {
  const asked: string[] = []

  return {
    asked,
    fetch: async (input) => {
      asked.push(input)
      const url = new URL(input)
      const text = world.files?.[`${url.origin}${url.pathname}`]
      return text ? new Response(text, { status: 200 }) : new Response('', { status: 404 })
    },
    resolveMx: async (domain) =>
      (world.mx?.[domain] ?? []).map((exchange, priority) => ({ exchange, priority })),
    resolveSrv: async (name) => {
      const record = world.srv?.[name]
      return record ? [{ ...record, priority: 0, weight: 0 }] : []
    },
    reachable: async (host, port) => world.open?.includes(`${host}:${port}`) ?? false
  }
}

describe('parseAutoconfig', () => {
  it('takes the first IMAP and SMTP servers that sign in with a password, placeholders filled', () => {
    expect(parseAutoconfig(LIBERO_LIKE, 'mario@studio.it')).toEqual({
      source: 'ispdb',
      provider: null,
      name: 'Posta dello Studio',
      pec: false,
      appPassword: false,
      imap: { host: 'imap.studio.it', port: 993, secure: true },
      smtp: { host: 'smtp.studio.it', port: 587, secure: false },
      username: 'mario',
      note: null
    })
  })

  it('takes nothing that is not a config file', () => {
    expect(parseAutoconfig('<html><body>Not found</body></html>', 'a@b.it')).toBeNull()
  })
})

describe('discoverMailSettings', () => {
  it('knows the providers of the address, PEC among them, without asking the network', async () => {
    const world = deps({})
    const libero = await discoverMailSettings('mario@libero.it', world)
    const pec = await discoverMailSettings('studio@pec.it', world)

    expect(libero?.imap).toEqual({ host: 'imapmail.libero.it', port: 993, secure: true })
    expect(pec).toMatchObject({ name: 'Aruba PEC', pec: true, source: 'known' })
    expect(world.asked).toEqual([])
  })

  it('reads the provider’s own file first, then Thunderbird’s database', async () => {
    const found = await discoverMailSettings(
      'mario@studio.it',
      deps({ files: { 'https://autoconfig.thunderbird.net/v1.1/studio.it': LIBERO_LIKE } })
    )

    expect(found).toMatchObject({ source: 'ispdb', username: 'mario' })
  })

  it('knows a company’s domain by its mail servers: a PEC at Aruba, a Microsoft 365 tenant', async () => {
    const pec = await discoverMailSettings(
      'ufficio@pec.studio.it',
      deps({ mx: { 'pec.studio.it': ['mx.pec.aruba.it'] } })
    )
    const office = await discoverMailSettings(
      'mario@azienda.it',
      deps({ mx: { 'azienda.it': ['azienda-it.mail.protection.outlook.com'] } })
    )

    expect(pec).toMatchObject({ name: 'Aruba PEC', pec: true })
    expect(office).toMatchObject({ provider: 'microsoft', name: 'Microsoft 365' })
  })

  it('looks the mail server’s provider up, then the SRV records, then guesses on the network', async () => {
    const byMx = await discoverMailSettings(
      'mario@negozio.it',
      deps({
        mx: { 'negozio.it': ['mx1.hostingfacile.net'] },
        files: { 'https://autoconfig.thunderbird.net/v1.1/hostingfacile.net': LIBERO_LIKE }
      })
    )
    const bySrv = await discoverMailSettings(
      'mario@srv.it',
      deps({
        srv: {
          '_imaps._tcp.srv.it': { name: 'mail.srv.it', port: 993 },
          '_submission._tcp.srv.it': { name: 'mail.srv.it', port: 587 }
        }
      })
    )
    const guessed = await discoverMailSettings(
      'mario@piccolo.it',
      deps({ open: ['mail.piccolo.it:993', 'smtp.piccolo.it:587'] })
    )

    expect(byMx).toMatchObject({ source: 'dns', smtp: { host: 'smtp.studio.it' } })
    expect(bySrv).toMatchObject({ source: 'dns', imap: { host: 'mail.srv.it', secure: true } })
    expect(guessed).toMatchObject({
      source: 'guess',
      imap: { host: 'mail.piccolo.it', port: 993 },
      smtp: { host: 'smtp.piccolo.it', port: 587, secure: false }
    })
    expect(await discoverMailSettings('mario@nulla.it', deps({}))).toBeNull()
  })
})
