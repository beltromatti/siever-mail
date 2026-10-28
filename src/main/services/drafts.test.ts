import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

const { draftFromParsedMail, DraftService, DRAFT_ID_HEADER } = await import('./drafts')
const { buildRawOutgoingMessage } = await import('./mail-engine/mail-transport')
const { parseMessageSource } = await import('./mail-engine/message-parts')

const DRAFT_ID = '5b0f5c1e-2f1d-4b7a-9a3e-6c2d1f0e9a11'
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('draftFromParsedMail', () => {
  it('reads back a draft as it was filed: recipients with Bcc, thread, files, inline pictures', async () => {
    const raw = await buildRawOutgoingMessage({
      from: { name: 'Anna', address: 'anna@siever.it' },
      to: [{ name: 'Mario Rossi', address: 'mario@cliente.it' }],
      cc: [{ address: 'ufficio@siever.it' }],
      bcc: [{ address: 'archivio@siever.it' }],
      subject: 'Re: Offerta 619',
      html: '<p>Buongiorno,</p><img src="cid:logo@siever">',
      text: 'Buongiorno,',
      inReplyTo: '<originale@cliente.it>',
      references: ['<primo@cliente.it>', '<originale@cliente.it>'],
      attachments: [
        {
          filename: 'Offerta.pdf',
          content: Buffer.from('%PDF-1.4'),
          contentType: 'application/pdf'
        },
        {
          filename: 'logo.png',
          content: PIXEL,
          cid: 'logo@siever',
          contentType: 'image/png',
          contentDisposition: 'inline'
        }
      ],
      messageId: `<draft.${DRAFT_ID}.3@siever.it>`,
      headers: { [DRAFT_ID_HEADER]: DRAFT_ID },
      keepBcc: true
    })

    const { content, files } = draftFromParsedMail(await parseMessageSource(raw), 'account-1')

    expect(content).toMatchObject({
      id: DRAFT_ID,
      kind: 'reply',
      accountId: 'account-1',
      to: [{ name: 'Mario Rossi', address: 'mario@cliente.it' }],
      cc: [{ address: 'ufficio@siever.it' }],
      bcc: [{ address: 'archivio@siever.it' }],
      subject: 'Re: Offerta 619',
      inReplyTo: '<originale@cliente.it>',
      references: ['<primo@cliente.it>', '<originale@cliente.it>']
    })
    expect(content.html).toContain(`src="data:image/png;base64,${PIXEL.toString('base64')}"`)
    expect(content.html).not.toContain('cid:')
    expect(files).toEqual([{ name: 'Offerta.pdf', content: Buffer.from('%PDF-1.4') }])
  })

  it('takes a draft another client wrote as a new one, its text as the body', async () => {
    const raw = await buildRawOutgoingMessage({
      from: { address: 'anna@siever.it' },
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      html: '',
      text: 'Riga uno\nRiga <due>',
      attachments: []
    })

    const { content } = draftFromParsedMail(await parseMessageSource(raw), 'account-1')

    expect(content.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(content.kind).toBe('new')
    expect(content.html).toContain('Riga uno<br>Riga &lt;due&gt;')
  })
})

describe('DraftService.hold', () => {
  const ACCOUNT = 'account-1'
  const BOZZE = '[Gmail]/Bozze'

  interface Harness {
    service: InstanceType<typeof DraftService>
    database: { deleteDraft: ReturnType<typeof vi.fn>; saveDraft: ReturnType<typeof vi.fn> }
    engine: { saveDraft: ReturnType<typeof vi.fn> }
    statuses: Array<{ id: string; state: string }>
  }

  /** A draft kept here, its copy in Bozze at `uid`, `ahead` saves the server lacks. */
  function setup(options: { uid: number; ahead?: boolean; uploadFails?: boolean }): Harness {
    let record: {
      content: {
        id: string
        accountId: string
        to: []
        cc: []
        bcc: []
        subject: string
        html: string
        attachments: []
        references: []
      }
      revision: number
      serverRevision: number
      server: { accountId: string; folderPath: string; uid: number }
      serverSavedAt: number | null
      docked: boolean
    } | null = {
      content: {
        id: DRAFT_ID,
        accountId: ACCOUNT,
        to: [],
        cc: [],
        bcc: [],
        subject: 'Offerta',
        html: '<div>Ciao</div>',
        attachments: [],
        references: []
      },
      revision: options.ahead ? 3 : 2,
      serverRevision: 2,
      server: { accountId: ACCOUNT, folderPath: BOZZE, uid: options.uid },
      serverSavedAt: 1,
      docked: true
    }
    const statuses: Array<{ id: string; state: string }> = []
    const database = {
      findDraftByServerCopy: vi.fn(async (_account: string, folder: string, uid: number) =>
        record && record.server.folderPath === folder && record.server.uid === uid ? record : null
      ),
      getDraft: vi.fn(async () => record),
      deleteDraft: vi.fn(async () => {
        record = null
      }),
      saveDraft: vi.fn(async () => undefined),
      markDraftFiled: vi.fn(async (_id: string, filed: { revision: number; uid: number }) => {
        if (record) {
          record = {
            ...record,
            serverRevision: filed.revision,
            server: { ...record.server, uid: filed.uid }
          }
        }
        return record
      })
    }
    const engine = {
      saveDraft: vi.fn(async () => {
        if (options.uploadFails) {
          throw new Error('Server non raggiungibile')
        }
        return { folderPath: BOZZE, uid: options.uid + 1 }
      }),
      purgeMessages: vi.fn(async () => ({ failed: [] }))
    }
    const service = new DraftService({
      database: database as never,
      engine: engine as never,
      getAccount: async () =>
        ({ id: ACCOUNT, email: 'anna@siever.it', displayName: 'Anna' }) as never,
      onStatus: (status) => statuses.push(status)
    })

    return { service, database, engine, statuses }
  }

  const copy = (uid: number): { accountId: string; folderPath: string; uid: number } => ({
    accountId: ACCOUNT,
    folderPath: BOZZE,
    uid
  })

  it('lets a draft go only once its copy left, and a late save does not bring it back', async () => {
    const { service, database, statuses } = setup({ uid: 10 })
    const held = await service.hold([copy(10)])

    expect(held.current.get(`${ACCOUNT}\u0000${BOZZE}\u000010`)).toEqual(copy(10))
    await held.settle([copy(10)])

    expect(database.deleteDraft).toHaveBeenCalledWith(DRAFT_ID)
    expect(statuses).toContainEqual({ id: DRAFT_ID, state: 'gone' })
    expect(await service.save({ id: DRAFT_ID } as never)).toEqual({ id: DRAFT_ID, state: 'gone' })
    expect(database.saveDraft).not.toHaveBeenCalled()
  })

  it('keeps the draft when its copy did not leave', async () => {
    const { service, database } = setup({ uid: 10 })
    const held = await service.hold([copy(10)])

    await held.settle([])

    expect(database.deleteDraft).not.toHaveBeenCalled()
  })

  it('files what is newer here first, and acts on the copy that holds it', async () => {
    const { service, engine } = setup({ uid: 10, ahead: true })
    const held = await service.hold([copy(10)])

    expect(engine.saveDraft).toHaveBeenCalled()
    expect(held.current.get(`${ACCOUNT}\u0000${BOZZE}\u000010`)).toEqual(copy(11))
    expect(held.refused).toEqual([])
    await held.settle([])
  })

  it('leaves in Bozze a draft the server could not take as it is', async () => {
    const { service, database } = setup({ uid: 10, ahead: true, uploadFails: true })
    const held = await service.hold([copy(10)])

    expect(held.refused).toEqual([copy(10)])
    expect(held.error).toBeDefined()
    expect(held.current.size).toBe(0)
    await held.settle([])
    expect(database.deleteDraft).not.toHaveBeenCalled()
  })
})
