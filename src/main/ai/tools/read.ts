import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

import type { MessageRef } from '@shared/models'

import { ensurePathReachable } from '../../services/network-volumes'
import { extractContent } from '../extraction'
import { threadMessages } from '../mail-search'
import type { ContentPart } from '../openrouter'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome
} from '../agent/tool-types'
import { commitmentLine, messageWork, noteLine, projectLine, rememberCommitments } from './describe'
import {
  clip,
  countOf,
  formatAddresses,
  formatDateTime,
  shortDate,
  withoutQuotedHistory
} from './format'

/** Characters of one message read at once. */
const MESSAGE_PAGE_CHARS = 30_000
/** Characters of each message, and of the whole, when a conversation is read. */
const THREAD_MESSAGE_CHARS = 8_000
const THREAD_TOTAL_CHARS = 60_000
/** Files read at most, in bytes: a document larger is not one to read in a conversation. */
const READ_MAX_BYTES = 40 * 1024 * 1024
/** Conversations of a project shown when it is read. */
const PROJECT_CONVERSATIONS_SHOWN = 30

type ReadMessage = Awaited<ReturnType<ToolContext['mail']['readMessage']>>

export function describeMessage(handle: string, message: ReadMessage): string {
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

export function attachmentsLine(
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

/**
 * What an extraction gave, for the model — text with where it goes on,
 * pictures to look at — and the step's line for the user.
 */
export function describeExtraction(
  handle: string,
  fileName: string,
  extracted: Awaited<ReturnType<typeof extractContent>>
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
    case 'pdf': {
      const scanned = extracted.pages.filter((page) => 'dataUrl' in page).length
      const shown = extracted.pages.map((page) => page.page)
      const range =
        shown.length === 0
          ? null
          : shown.length === 1
            ? `pagina ${shown[0]}`
            : `pagine ${shown[0]}–${shown[shown.length - 1]}`
      const content: ContentPart[] = [
        {
          type: 'text',
          text: `${handle} ${fileName} · PDF di ${countOf(extracted.totalPages, 'pagina', 'pagine')}${
            range ? ` · qui ${shown.length === 1 ? 'la' : 'le'} ${range}` : ''
          }${scanned > 0 ? ' (le pagine scansionate sono immagini da guardare)' : ''}`
        }
      ]

      for (const page of extracted.pages) {
        content.push(
          'text' in page
            ? { type: 'text', text: `— Pagina ${page.page} —\n${page.text}` }
            : { type: 'text', text: `— Pagina ${page.page} (scansione) —` },
          ...('dataUrl' in page
            ? [{ type: 'image_url' as const, image_url: { url: page.dataUrl } }]
            : [])
        )
      }

      if (extracted.nextPage !== null) {
        content.push({ type: 'text', text: `[Continua con pagina=${extracted.nextPage}.]` })
      }

      return {
        content,
        summary: `${scanned > 0 ? 'Guardato' : 'Letto'} ${fileName}${
          range && extracted.totalPages > 1 ? ` · ${range}` : ''
        }`
      }
    }
    case 'text':
      return {
        content: [
          `${handle} ${fileName} · ${extracted.totalChars} caratteri`,
          '',
          extracted.text || '(nessun testo)',
          extracted.nextOffset !== null
            ? `\n[Continua con da_carattere=${extracted.nextOffset}.]`
            : ''
        ]
          .filter((line) => line !== '')
          .join('\n'),
        summary: `Letto ${fileName}`
      }
  }
}

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function readOneMessage(
  context: ToolContext,
  handle: string,
  ref: MessageRef,
  offset: number
): Promise<ToolOutcome> {
  const message = await context.mail.readMessage(ref)
  const body = message.textForReading.slice(offset)
  const page = clip(body, MESSAGE_PAGE_CHARS)

  return {
    content: [
      describeMessage(handle, message),
      ...(await messageWork(context, ref, message.messageKey, message.threadId)),
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

async function readConversation(context: ToolContext, ref: MessageRef): Promise<ToolOutcome> {
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
    const note = await context.registry.notes.get(threadRef.accountId, item.messageKey)
    total += page.text.length

    parts.push(
      [
        `## ${index + 1}/${refs.length}`,
        describeMessage(itemHandle, item),
        note ? `La tua nota: ${noteLine(note)}` : '',
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

  const last = refs[refs.length - 1] ?? ref
  const lastMessage = last === ref ? message : await context.mail.readMessage(last)
  const work = await messageWork(context, last, lastMessage.messageKey, message.threadId)

  return {
    content: `Conversazione di ${countOf(refs.length, 'messaggio', 'messaggi')}, dal più vecchio:\n\n${parts.join('\n\n')}${
      omitted > 0
        ? `\n\n[${countOf(omitted, 'messaggio più recente non mostrato', 'messaggi più recenti non mostrati')} per spazio: leggili uno per uno.]`
        : ''
    }\n\n# Il lavoro su questa conversazione\n${work.join('\n')}`,
    summary:
      refs.length === 1
        ? `Letto «${message.subject}»`
        : `Letta la conversazione «${message.subject}» · ${countOf(refs.length, 'messaggio', 'messaggi')}`,
    messages: refs
  }
}

async function readFileAt(
  context: ToolContext,
  path: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  await ensurePathReachable(path)
  const info = await stat(path).catch(() => null)

  if (!info?.isFile()) {
    throw new ToolInputError(`Il file «${path}» non c'è o non si può aprire.`)
  }

  if (info.size > READ_MAX_BYTES) {
    throw new ToolInputError(
      `«${basename(path)}» è troppo grande da leggere (${sizeLabel(info.size)}).`
    )
  }

  const handle = context.handles.name(
    { kind: 'file', file: { kind: 'path', path, fileName: basename(path) } },
    context.newHandles
  )
  const outcome = describeExtraction(
    handle,
    basename(path),
    await extractContent(basename(path), undefined, await readFile(path), {
      offset: numberArg(args, 'da_carattere'),
      page: numberArg(args, 'pagina')
    })
  )

  return { ...outcome, files: [path] }
}

async function readEvent(
  context: ToolContext,
  handle: string,
  eventKey: string
): Promise<ToolOutcome> {
  const event = await context.calendar.event(eventKey)

  if (!event) {
    return {
      content: `${handle}: l'evento non c'è più nel calendario.`,
      summary: 'Evento non più presente',
      failed: true
    }
  }

  return {
    content: [
      `${handle} · ${event.title}`,
      `Quando: ${event.allDay ? `${event.start} (tutto il giorno)` : `${formatDateTime(event.start)} – ${formatDateTime(event.end)}`}`,
      `Calendario: ${event.calendarName}`,
      event.location ? `Dove: ${event.location}` : '',
      event.organizer ? `Organizzatore: ${event.organizer}` : '',
      event.attendees.length > 0
        ? `Invitati: ${event.attendees.map((attendee) => `${attendee.name ?? attendee.email} (${attendee.response})`).join(', ')}`
        : '',
      event.myResponse ? `La risposta dell'utente: ${event.myResponse}` : '',
      event.meetLink ? `Call: ${event.meetLink}` : '',
      event.description ? `\n${clip(event.description, 6000).text}` : ''
    ]
      .filter(Boolean)
      .join('\n'),
    summary: `Letto l'evento «${event.title}»`
  }
}

/** What reading a project needs: the mail, the registry, the run's names and what it saw. */
export type ProjectReader = Pick<ToolContext, 'mail' | 'registry' | 'handles' | 'newHandles'> & {
  run: Pick<ToolContext['run'], 'seen'>
}

export async function readProject(context: ProjectReader, projectId: string): Promise<ToolOutcome> {
  const project = await context.registry.projects.summary(projectId)

  if (!project) {
    throw new ToolInputError('Questo progetto non esiste più.')
  }

  const accountIds = (await context.mail.listAccounts()).map((account) => account.id)
  const threads = await context.registry.projects.threadsOf(projectId, accountIds)
  const [items, notes, resources] = await Promise.all([
    context.registry.commitments.ofThreads(threads),
    context.registry.notes.ofThreads(threads),
    context.registry.projects.resources(projectId)
  ])
  rememberCommitments(context, items)

  // Each conversation by its latest note, the newest first.
  const latest = new Map<string, (typeof notes)[number]>()

  for (const note of notes) {
    const key = `${note.accountId}\u0000${note.threadId}`
    const known = latest.get(key)

    if (!known || note.messageDate > known.messageDate) {
      latest.set(key, note)
    }
  }

  const conversations = [...latest.values()].sort((a, b) =>
    b.messageDate.localeCompare(a.messageDate)
  )
  const lines: string[] = []

  for (const note of conversations.slice(0, PROJECT_CONVERSATIONS_SHOWN)) {
    const summary = (await context.mail.messageSummaries(note.accountId, [note.messageKey])).get(
      note.messageKey
    )

    if (summary) {
      const handle = context.handles.name(
        { kind: 'message', ref: summary.ref, messageKey: note.messageKey },
        context.newHandles
      )
      lines.push(
        `${handle} · ${shortDate(note.messageDate)} · ${formatAddresses(summary.from, 1)} · «${summary.subject}» — ${note.summary}`
      )
    }
  }

  return {
    content: [
      projectLine(context, project),
      project.state
        ? `Il punto (scritto il ${shortDate(new Date(project.stateAt ?? project.updatedAt).toISOString())}${project.staleSince ? ', poi qualcosa si è mosso: va aggiornato' : ''}):\n${project.state}`
        : 'Il punto: non ancora scritto.',
      resources.length > 0
        ? `Risorse: ${resources.map((resource) => `${resource.label ?? ''} ${resource.location}`.trim()).join(' · ')}`
        : '',
      items.length > 0
        ? `Cose aperte (e chiuse di recente):\n${items.map((item) => `  ${commitmentLine(item)}`).join('\n')}`
        : 'Niente di aperto.',
      `Conversazioni, dalla più recente${conversations.length > PROJECT_CONVERSATIONS_SHOWN ? ` (le ultime ${PROJECT_CONVERSATIONS_SHOWN} di ${conversations.length})` : ''}:\n${lines.join('\n') || '(nessuna)'}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    summary: `Letto il progetto ${project.title}`
  }
}

export const readTool: SegretarioTool = {
  name: 'leggi',
  description: PROMPTS.tools.leggi,
  parameters: {
    type: 'object',
    properties: {
      cosa: { type: 'string' },
      conversazione: { type: 'boolean' },
      da_carattere: { type: 'integer' },
      pagina: { type: 'integer' }
    },
    required: ['cosa']
  },
  running: (args) => (booleanArg(args, 'conversazione') ? 'Leggo la conversazione…' : 'Leggo…'),
  async execute(args, context) {
    const reference = requireString(args, 'cosa')

    if (isAbsolute(reference)) {
      return readFileAt(context, reference, args)
    }

    const target = context.handles.resolve(reference)

    switch (target?.kind) {
      case 'message':
        return booleanArg(args, 'conversazione')
          ? readConversation(context, target.ref)
          : readOneMessage(
              context,
              reference,
              target.ref,
              Math.max(0, numberArg(args, 'da_carattere') ?? 0)
            )
      case 'file': {
        if (target.file.kind === 'path') {
          return readFileAt(context, target.file.path, args)
        }

        const file = target.file
        const message = await context.mail.readMessage(file.ref)
        const attachment = message.attachments.find((item) => item.id === file.attachmentId)

        if (!attachment) {
          throw new ToolInputError(`L'allegato «${file.fileName}» non è più nel messaggio.`)
        }

        const { data, contentType } = await context.mail.attachmentContent(file.ref, attachment)
        return describeExtraction(
          reference,
          file.fileName,
          await extractContent(file.fileName, contentType ?? attachment.contentType, data, {
            offset: numberArg(args, 'da_carattere'),
            page: numberArg(args, 'pagina')
          })
        )
      }
      case 'event':
        return readEvent(context, reference, target.eventKey)
      case 'project':
        return readProject(context, target.projectId)
      case 'draft': {
        const draft = await context.mail.getDraft(target.draftId)

        if (!draft) {
          return {
            content: `${reference}: la bozza non c'è più.`,
            summary: 'Bozza non più presente',
            failed: true
          }
        }

        return {
          content: [
            `${reference} · bozza`,
            `A: ${draft.to.join(', ')}`,
            draft.cc.length ? `Cc: ${draft.cc.join(', ')}` : '',
            `Oggetto: ${draft.subject}`,
            '',
            draft.text,
            draft.attachments.length ? `Allegati: ${draft.attachments.join(', ')}` : ''
          ]
            .filter((line) => line !== '')
            .join('\n'),
          summary: `Letta la bozza «${draft.subject}»`
        }
      }
      default:
        throw new ToolInputError(
          `Non conosco «${reference}»: in questa conversazione non l'hai ricevuto. I riferimenti (m…, f…, e…, p…, b…) arrivano dagli strumenti: un messaggio da \`cerca_posta\`, un progetto da \`progetti\`, un evento da \`calendario\`. Un file si legge anche dal suo percorso completo.`
        )
    }
  }
}
