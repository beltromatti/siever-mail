import type { MessageRef } from '@shared/models'

import { extractContent } from '../extraction'
import { folderQueryLabel, searchMail, searchScope, threadMessages } from '../mail-search'
import type { ContentPart } from '../openrouter'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import {
  clip,
  countOf,
  formatAddresses,
  formatDateTime,
  shortDate,
  withoutQuotedHistory
} from './format'

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 50
/** Characters of one message read at once. */
const MESSAGE_PAGE_CHARS = 30_000
/** Characters of each message, and of the whole, when a conversation is read. */
const THREAD_MESSAGE_CHARS = 8_000
const THREAD_TOTAL_CHARS = 60_000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function messageOf(context: ToolContext, handle: string): { ref: MessageRef; messageKey: string } {
  const message = context.handles.message(handle)

  if (!message) {
    throw new ToolInputError(
      `Non conosco il messaggio «${handle}»: usa un riferimento ricevuto da cerca_posta o leggi_posta.`
    )
  }

  return message
}

export const searchMailTool: SegretarioTool = {
  name: 'cerca_posta',
  description: PROMPTS.tools.cerca_posta,
  parameters: {
    type: 'object',
    properties: {
      testo: { type: 'string' },
      account: { type: 'string' },
      cartella: { type: 'string' },
      dal: { type: 'string' },
      al: { type: 'string' },
      non_lette: { type: 'boolean' },
      con_allegati: { type: 'boolean' },
      limite: { type: 'integer' }
    }
  },
  running: (args) =>
    stringArg(args, 'testo') ? `Cerco «${stringArg(args, 'testo')}»…` : 'Cerco nella posta…',
  async execute(args, context) {
    const from = stringArg(args, 'dal')
    const to = stringArg(args, 'al')

    for (const [name, value] of [
      ['dal', from],
      ['al', to]
    ] as const) {
      if (value && !ISO_DATE.test(value)) {
        throw new ToolInputError(`\`${name}\` va scritto come AAAA-MM-GG.`)
      }
    }

    const accounts = await context.mail.listAccounts()
    const folders = new Map(
      await Promise.all(
        accounts.map(
          async (account) => [account.id, await context.mail.listFolders(account.id)] as const
        )
      )
    )
    const account = stringArg(args, 'account')
    const folder = stringArg(args, 'cartella')
    const scope = searchScope(accounts, folders, {
      accounts: account ? [account] : [],
      folder
    })

    if (scope.mailboxes.size === 0) {
      throw new ToolInputError(
        account && !accounts.some((item) => item.email.toLowerCase() === account.toLowerCase())
          ? `Nessun account «${account}». Gli account sono: ${accounts.map((item) => item.email).join(', ')}.`
          : `Nessuna cartella «${folder}» negli account indicati.`
      )
    }

    const text = stringArg(args, 'testo')
    const unreadOnly = booleanArg(args, 'non_lette')
    const limit = Math.min(
      MAX_SEARCH_LIMIT,
      Math.max(1, numberArg(args, 'limite') ?? DEFAULT_SEARCH_LIMIT)
    )
    const hits = await searchMail(await context.mail.searchClient(), scope, {
      text,
      from,
      to,
      unreadOnly,
      withAttachments: booleanArg(args, 'con_allegati'),
      limit
    })

    // What was looked for, where and when, as the step's line tells it.
    const looked = [
      'Cercato',
      text ? `«${text}»` : unreadOnly ? 'i non letti' : null,
      folder ? `in ${folderQueryLabel(folder)}` : account ? null : 'in tutta la posta',
      account ? `di ${account}` : null,
      from && to
        ? `dal ${shortDate(from)} al ${shortDate(to)}`
        : from
          ? `dal ${shortDate(from)}`
          : to
            ? `fino al ${shortDate(to)}`
            : null
    ]
      .filter(Boolean)
      .join(' ')

    if (hits.length === 0) {
      return { content: 'Nessun messaggio trovato.', summary: `${looked} · nessun risultato` }
    }

    const lines = hits.map((hit) => {
      const handle = context.handles.name(
        { kind: 'message', ref: hit.ref, messageKey: hit.messageKey },
        context.newHandles
      )
      const flags = [hit.isRead ? null : 'non letto', hit.hasAttachments ? 'con allegati' : null]
        .filter(Boolean)
        .join(', ')

      return [
        `${handle} · ${formatDateTime(hit.date)} · da ${formatAddresses(hit.from, 2)} · a ${formatAddresses([...hit.to, ...hit.cc], 3)}`,
        `   «${hit.subject}» · ${hit.folderLabel} · ${hit.accountEmail}${flags ? ` · ${flags}` : ''}`,
        `   ${hit.snippet.replace(/\s+/g, ' ').trim().slice(0, 320)}`
      ].join('\n')
    })

    return {
      content: `${countOf(hits.length, 'messaggio', 'messaggi')}${text ? ', i più pertinenti per primi' : ', i più recenti per primi'}${hits.length === limit ? ' (potrebbero essercene altri: restringi o alza il limite)' : ''}:\n\n${lines.join('\n\n')}`,
      summary: `${looked} · ${countOf(hits.length, 'messaggio', 'messaggi')}`,
      messages: hits.map((hit) => hit.ref)
    }
  }
}

export const readMailTool: SegretarioTool = {
  name: 'leggi_posta',
  description: PROMPTS.tools.leggi_posta,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      conversazione: { type: 'boolean' },
      da_carattere: { type: 'integer' }
    },
    required: ['messaggio']
  },
  running: (args) =>
    booleanArg(args, 'conversazione') ? 'Leggo la conversazione…' : 'Leggo il messaggio…',
  async execute(args, context) {
    const handle = requireString(args, 'messaggio')
    const { ref } = messageOf(context, handle)

    if (!booleanArg(args, 'conversazione')) {
      const message = await context.mail.readMessage(ref)
      const offset = Math.max(0, numberArg(args, 'da_carattere') ?? 0)
      const body = message.textForReading.slice(offset)
      const page = clip(body, MESSAGE_PAGE_CHARS)

      return {
        content: [
          describeMessage(handle, message),
          '',
          page.text || '(nessun testo)',
          page.clipped
            ? `\n[Testo accorciato: continua con da_carattere=${offset + MESSAGE_PAGE_CHARS}, su ${message.textForReading.length} caratteri.]`
            : '',
          attachmentsLine(context, ref, message.attachments)
        ]
          .filter((line) => line !== '')
          .join('\n'),
        summary: `Letto «${message.subject}»`,
        messages: [ref]
      }
    }

    const message = await context.mail.readMessage(ref)
    const refs = await threadMessages(
      await context.mail.searchClient(),
      ref.accountId,
      message.threadId,
      await context.mail.listFolders(ref.accountId)
    )
    const parts: string[] = []
    let total = 0
    let omitted = 0

    for (const [index, threadRef] of refs.entries()) {
      if (total >= THREAD_TOTAL_CHARS) {
        omitted += 1
        continue
      }

      const item = await context.mail.readMessage(threadRef)
      const itemHandle = context.handles.name(
        { kind: 'message', ref: threadRef, messageKey: item.messageKey },
        context.newHandles
      )
      const own =
        index === 0
          ? { text: item.textForReading, cut: false }
          : withoutQuotedHistory(item.textForReading)
      const page = clip(own.text, THREAD_MESSAGE_CHARS)
      total += page.text.length

      parts.push(
        [
          `## ${index + 1}/${refs.length}`,
          describeMessage(itemHandle, item),
          '',
          page.text || '(nessun testo)',
          own.cut ? '[Citazioni dei messaggi precedenti omesse.]' : '',
          page.clipped ? `[Accorciato: leggi ${itemHandle} da solo per il testo intero.]` : '',
          attachmentsLine(context, threadRef, item.attachments)
        ]
          .filter((line) => line !== '')
          .join('\n')
      )
    }

    return {
      content: `Conversazione di ${countOf(refs.length, 'messaggio', 'messaggi')}, dal più vecchio:\n\n${parts.join('\n\n')}${omitted > 0 ? `\n\n[${countOf(omitted, 'messaggio più recente non mostrato', 'messaggi più recenti non mostrati')} per spazio: leggili uno per uno.]` : ''}`,
      summary:
        refs.length === 1
          ? `Letto «${message.subject}»`
          : `Letta la conversazione «${message.subject}» · ${countOf(refs.length, 'messaggio', 'messaggi')}`,
      messages: refs
    }
  }
}

function describeMessage(
  handle: string,
  message: Awaited<ReturnType<ToolContext['mail']['readMessage']>>
): string {
  return [
    `${handle} · ${formatDateTime(message.date)}`,
    `Da: ${formatAddresses(message.from)}`,
    `A: ${formatAddresses(message.to, 12)}`,
    message.cc.length > 0 ? `Cc: ${formatAddresses(message.cc, 12)}` : '',
    `Oggetto: ${message.subject}`,
    `Cartella: ${message.folderPath}${message.isRead ? '' : ' · non letto'}${message.isFlagged ? ' · contrassegnato' : ''}`
  ]
    .filter(Boolean)
    .join('\n')
}

function attachmentsLine(
  context: ToolContext,
  ref: MessageRef,
  attachments: ReadonlyArray<{ id: string; fileName: string; size: number; contentType?: string }>
): string {
  if (attachments.length === 0) {
    return ''
  }

  const items = attachments.map((attachment) => {
    const handle = context.handles.name(
      {
        kind: 'file',
        file: {
          kind: 'attachment',
          ref,
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          contentType: attachment.contentType
        }
      },
      context.newHandles
    )

    return `${handle} ${attachment.fileName} (${Math.max(1, Math.round(attachment.size / 1024))} KB)`
  })

  return `Allegati: ${items.join(' · ')}`
}

export const readAttachmentTool: SegretarioTool = {
  name: 'leggi_allegato',
  description: PROMPTS.tools.leggi_allegato,
  parameters: {
    type: 'object',
    properties: {
      allegato: { type: 'string' },
      da_carattere: { type: 'integer' },
      pagina: { type: 'integer' }
    },
    required: ['allegato']
  },
  running: () => "Leggo l'allegato…",
  async execute(args, context) {
    const handle = requireString(args, 'allegato')
    const file = context.handles.file(handle)

    if (!file || file.kind !== 'attachment') {
      throw new ToolInputError(
        `«${handle}» non è un allegato che conosco: usa un riferimento ricevuto da leggi_posta.`
      )
    }

    const message = await context.mail.readMessage(file.ref)
    const attachment = message.attachments.find((item) => item.id === file.attachmentId)

    if (!attachment) {
      throw new ToolInputError(`L'allegato «${file.fileName}» non è più nel messaggio.`)
    }

    const { data, contentType } = await context.mail.attachmentContent(file.ref, attachment)
    return describeExtraction(
      handle,
      file.fileName,
      await extractContent(file.fileName, contentType ?? attachment.contentType, data, {
        offset: numberArg(args, 'da_carattere'),
        page: numberArg(args, 'pagina')
      }),
      `Letto ${file.fileName}`
    )
  }
}

/** What an extraction gave, for the model: text with where it goes on, or a picture to look at. */
export function describeExtraction(
  handle: string,
  fileName: string,
  extracted: Awaited<ReturnType<typeof extractContent>>,
  summary: string
): { content: string | ContentPart[]; summary: string; failed?: boolean } {
  switch (extracted.kind) {
    case 'image':
      return {
        content: [
          { type: 'text', text: `${handle} ${fileName}: l'immagine è qui sotto.` },
          { type: 'image_url', image_url: { url: extracted.dataUrl } }
        ],
        summary: `Guardato ${fileName}`
      }
    case 'unreadable':
      return {
        content: `${handle} ${fileName}: ${extracted.reason}`,
        summary: `Non letto ${fileName}`,
        failed: true
      }
    case 'text':
      return {
        content: [
          `${handle} ${fileName}${extracted.pages ? ` · ${extracted.pages} pagine` : ''} · ${extracted.totalChars} caratteri`,
          '',
          extracted.text || '(nessun testo)',
          extracted.nextOffset !== null
            ? `\n[Continua con da_carattere=${extracted.nextOffset}.]`
            : ''
        ]
          .filter((line) => line !== '')
          .join('\n'),
        summary
      }
  }
}

const ORGANIZE_ACTIONS = [
  'archivia',
  'sposta',
  'contrassegna',
  'togli_contrassegno',
  'segna_letto',
  'segna_non_letto',
  'cestina'
] as const

const ACTION_LINES: Readonly<Record<(typeof ORGANIZE_ACTIONS)[number], string>> = {
  archivia: 'Archiviati',
  sposta: 'Spostati',
  contrassegna: 'Contrassegnati',
  togli_contrassegno: 'Tolto il contrassegno a',
  segna_letto: 'Segnati come letti',
  segna_non_letto: 'Segnati come non letti',
  cestina: 'Spostati nel cestino'
}

export const organizeTool: SegretarioTool = {
  name: 'organizza',
  description: PROMPTS.tools.organizza,
  parameters: {
    type: 'object',
    properties: {
      messaggi: { type: 'array', items: { type: 'string' } },
      azione: { type: 'string', enum: [...ORGANIZE_ACTIONS] },
      cartella: { type: 'string' }
    },
    required: ['messaggi', 'azione']
  },
  running: () => 'Metto in ordine…',
  async execute(args, context) {
    const action = requireString(args, 'azione') as (typeof ORGANIZE_ACTIONS)[number]

    if (!ORGANIZE_ACTIONS.includes(action)) {
      throw new ToolInputError(`Azione sconosciuta «${action}».`)
    }

    const refs = stringListArg(args, 'messaggi').map((handle) => messageOf(context, handle).ref)

    if (refs.length === 0) {
      throw new ToolInputError('Indica almeno un messaggio.')
    }

    let result

    switch (action) {
      case 'archivia':
        result = await context.mail.archive(refs)
        break
      case 'sposta': {
        const folderName = requireString(args, 'cartella').toLowerCase()
        const accountIds = [...new Set(refs.map((ref) => ref.accountId))]

        if (accountIds.length > 1) {
          throw new ToolInputError(
            'Sposta i messaggi di un account alla volta: le cartelle sono di ciascun account.'
          )
        }

        const folders = await context.mail.listFolders(accountIds[0])
        const folder = folders.find(
          (item) => item.path.toLowerCase() === folderName || item.name.toLowerCase() === folderName
        )

        if (!folder) {
          throw new ToolInputError(
            `Nessuna cartella «${folderName}» in questo account. Ci sono: ${folders.map((item) => item.path).join(', ')}.`
          )
        }

        result = await context.mail.move(refs, folder.path)
        break
      }
      case 'contrassegna':
        result = await context.mail.setFlagged(refs, true)
        break
      case 'togli_contrassegno':
        result = await context.mail.setFlagged(refs, false)
        break
      case 'segna_letto':
        result = await context.mail.setSeen(refs, true)
        break
      case 'segna_non_letto':
        result = await context.mail.setSeen(refs, false)
        break
      case 'cestina':
        result = await context.mail.trash(refs)
        break
    }

    const failed = result.failed.length
    const done = refs.length - failed

    return {
      content:
        failed === 0
          ? `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}.`
          : `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}; ${failed} non riusciti${result.error ? `: ${result.error}` : '.'}`,
      summary: `${ACTION_LINES[action]} ${countOf(done, 'messaggio', 'messaggi')}`,
      messages: refs,
      failed: done === 0
    }
  }
}
