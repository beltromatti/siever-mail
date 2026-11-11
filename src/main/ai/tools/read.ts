import { open, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

import { seriesKey } from '@shared/calendar'
import type { MessageRef } from '@shared/models'
import { pecReceiptAt, pecReceiptWords } from '@shared/pec'
import { unlinked } from '@shared/segretario-links'

import { looksLikeText, TEXT_SNIFF_BYTES } from '../document-formats'
import { extractContent, knownFormat } from '../extraction'
import { reachShare } from './files'
import { threadMessages } from '../mail-search'
import type { ContentPart } from '../openrouter'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  requireString,
  markSeenKey,
  seenKey,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome,
  UnknownHandle
} from '../agent/tool-types'
import { commitmentLine, messageWork, noteLine, projectLine, rememberCommitments } from './describe'
import {
  clip,
  countOf,
  eventWhen,
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
/** Conversations of a project shown at once when it is read: the others by `pagina`. */
const PROJECT_CONVERSATIONS_SHOWN = 30

type ReadMessage = Awaited<ReturnType<ToolContext['mail']['readMessage']>>

export function describeMessage(handle: string, message: ReadMessage): string {
  return [
    `${handle} · ${formatDateTime(message.date)}`,
    `Da: ${formatAddresses(message.from)}`,
    `A: ${formatAddresses(message.to, 12)}`,
    message.cc.length > 0 ? `Cc: ${formatAddresses(message.cc, 12)}` : '',
    `Oggetto: ${message.subject}`,
    `Cartella: ${message.folderPath}${message.isRead ? '' : ' · non letto'}${message.isFlagged ? ' · contrassegnato' : ''}`,
    pecLine(message)
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * What certified mail (PEC) says of a message: the certification of one
 * that came in the provider's envelope, what a receipt says of the message
 * sent it is about, the receipts on one the user sent.
 */
function pecLine(message: ReadMessage): string {
  const certification = message.pecDetail?.certification ?? null
  const by = certification?.provider ? ` da ${certification.provider}` : ''
  const at = certification?.at ? ` il ${formatDateTime(certification.at)}` : ''

  if (message.pec?.kind === 'busta') {
    return `PEC: messaggio certificato${by}${at}.`
  }

  if (message.pec?.kind === 'anomalia') {
    return `PEC: anomalia — il gestore non ha potuto certificarlo (mittente non PEC, o messaggio alterato)${at}.`
  }

  if (message.pec) {
    return `Ricevuta PEC: ${pecReceiptWords(message.pec.kind, certification)}${at}, del messaggio inviato «${message.subject}».`
  }

  return message.pecReceipts && message.pecReceipts.length > 0
    ? `PEC: ${message.pecReceipts
        .map(
          (receipt) =>
            `${pecReceiptWords(receipt.kind, receipt.certification)} il ${formatDateTime(pecReceiptAt(receipt))}`
        )
        .join('; ')}.`
    : ''
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
      const scanned = extracted.pages.filter((page) => page.dataUrl && !page.text).length
      const looked = extracted.pages.filter((page) => page.dataUrl).length
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
          }${
            looked > scanned
              ? ' (ogni pagina con il suo testo e la sua immagine)'
              : scanned > 0
                ? ' (le pagine scansionate sono immagini da guardare)'
                : ''
          }`
        }
      ]

      for (const page of extracted.pages) {
        content.push(
          page.dataUrl && !page.text
            ? { type: 'text', text: `— Pagina ${page.page} (scansione) —` }
            : { type: 'text', text: `— Pagina ${page.page} —\n${page.text}` },
          ...(page.dataUrl
            ? [{ type: 'image_url' as const, image_url: { url: page.dataUrl } }]
            : [])
        )
      }

      if (extracted.nextPage !== null) {
        content.push({ type: 'text', text: `[Continua con pagina=${extracted.nextPage}.]` })
      }

      return {
        content,
        summary: `${looked > 0 ? 'Guardato' : 'Letto'} ${fileName}${
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
  const thread = await threadMessages(
    await context.mail.searchClient(),
    ref.accountId,
    message.threadId,
    await context.mail.listFolders(ref.accountId)
  )
  const refs = thread.map((entry) => entry.ref)

  // Every message named; past the room there is, the first and the newest are given whole and
  // those in the middle by a line each, to read one by one if they matter. Only the messages
  // given whole are read: a long conversation does not fetch what it will not show.
  const read = new Map<number, Awaited<ReturnType<typeof readThreadMessage>>>()
  const unreadable = new Map<number, string>()
  let total = 0

  // The first, then from the newest back.
  const order = thread.length === 0 ? [] : [0, ...[...thread.keys()].slice(1).reverse()]

  for (const index of order) {
    try {
      const entry = await readThreadMessage(context, thread[index].ref, index === 0)

      if (read.size > 1 && total + entry.page.text.length > THREAD_TOTAL_CHARS) {
        break
      }

      read.set(index, entry)
      total += entry.page.text.length
    } catch (error) {
      unreadable.set(index, error instanceof Error ? error.message : String(error))
    }
  }

  const parts: string[] = []
  const skipped: string[] = []

  const flushSkipped = (): void => {
    if (skipped.length > 0) {
      parts.push(
        `[${countOf(skipped.length, 'messaggio', 'messaggi')} in mezzo, non mostrati per spazio: leggili da soli se servono]\n${skipped.join('\n')}`
      )
      skipped.length = 0
    }
  }

  for (const [index, entry] of thread.entries()) {
    const handle = context.handles.name(
      { kind: 'message', ref: entry.ref, messageKey: entry.messageKey },
      context.newHandles
    )
    const whole = read.get(index)
    const line = `- ${handle} · ${formatDateTime(entry.dateIso)} · ${formatAddresses(entry.from, 1)} · «${entry.subject}»`

    if (unreadable.has(index)) {
      flushSkipped()
      parts.push(`${line} — non si legge ora: ${unreadable.get(index)}`)
      continue
    }

    if (!whole) {
      skipped.push(line)
      continue
    }

    flushSkipped()
    const { item, own, page } = whole
    const note = await context.registry.notes.get(entry.ref.accountId, entry.messageKey)
    context.run.seen.set(
      seenKey('note', entry.ref.accountId, entry.messageKey),
      note?.revision ?? 0
    )
    parts.push(
      [
        `## ${index + 1}/${thread.length}`,
        describeMessage(handle, item),
        note ? `La tua nota: ${noteLine(note)}` : '',
        '',
        page.text || '(nessun testo)',
        own.cut ? '[Citazioni dei messaggi precedenti omesse.]' : '',
        page.clipped ? `[Accorciato: leggi ${handle} da solo per il testo intero.]` : '',
        attachmentsLine(context, entry.ref, item.attachments)
      ]
        .filter((part) => part !== '')
        .join('\n')
    )
  }

  flushSkipped()

  const last = thread[thread.length - 1]
  const work = await messageWork(
    context,
    last?.ref ?? ref,
    last?.messageKey ?? message.messageKey,
    message.threadId
  )

  return {
    content: `Conversazione di ${countOf(thread.length, 'messaggio', 'messaggi')}, dal più vecchio:\n\n${parts.join('\n\n')}\n\n# Il lavoro su questa conversazione\n${work.join('\n')}`,
    summary:
      thread.length <= 1
        ? `Letto «${message.subject}»`
        : `Letta la conversazione «${message.subject}» · ${countOf(thread.length, 'messaggio', 'messaggi')}`,
    messages: refs
  }
}

/** A message of a conversation as it is shown whole: the first with what it quotes, the others without. */
async function readThreadMessage(
  context: ToolContext,
  ref: MessageRef,
  first: boolean
): Promise<{
  item: Awaited<ReturnType<ToolContext['mail']['readMessage']>>
  own: { text: string; cut: boolean }
  page: ReturnType<typeof clip>
}> {
  const item = await context.mail.readMessage(ref)
  const own = first
    ? { text: item.textForReading, cut: false }
    : withoutQuotedHistory(item.textForReading)

  return { item, own, page: clip(own.text, THREAD_MESSAGE_CHARS) }
}

/** The first `bytes` of a file, without reading the rest. */
async function readHead(path: string, bytes: number): Promise<Buffer> {
  const file = await open(path, 'r')

  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(bytes), 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

async function readFileAt(
  context: ToolContext,
  given: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const path = await reachShare(context, given)
  const info = await stat(path).catch(() => null)

  if (!info?.isFile()) {
    throw new ToolInputError(`Il file «${path}» non c'è o non si può aprire.`)
  }

  const handle = context.handles.name(
    { kind: 'file', file: { kind: 'path', path, fileName: basename(path) } },
    context.newHandles
  )
  const name = basename(path)
  // A large file of a format not known by name is read whole only when it is text: a video or a
  // program is said for what it is, not loaded to be refused.
  const head =
    knownFormat(name) || info.size <= TEXT_SNIFF_BYTES
      ? null
      : await readHead(path, TEXT_SNIFF_BYTES)
  const outcome = describeExtraction(
    handle,
    name,
    await extractContent(
      name,
      undefined,
      head && !looksLikeText(head) ? head : await readFile(path),
      {
        offset: numberArg(args, 'da_carattere'),
        page: numberArg(args, 'pagina'),
        look: booleanArg(args, 'guarda')
      }
    )
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

  // What the work holds of it, as a message's reading says its note and what is open.
  const series = event.seriesId
    ? seriesKey(event.connectionId, event.calendarId, event.seriesId)
    : null
  const [prep, alerts, items, projects, mark] = await Promise.all([
    context.registry.day.prep(eventKey),
    context.registry.alerts.of({ kind: 'event', eventKey }),
    context.registry.commitments.ofPlaces({ events: [eventKey] }),
    context.registry.projects.ofEvents([eventKey]),
    context.registry.ownership.markOf(eventKey, series)
  ])
  rememberCommitments(context, items)
  // What it saw of what it may write over (§4.6): the preparation, whose it is — none, too.
  context.run.seen.set(seenKey('prep', eventKey), prep?.writtenAt ?? 0)
  context.run.seen.set(markSeenKey({ eventKey, seriesKey: series }), mark?.setAt ?? 0)
  // Whose it is (§7.4): what the calendar says, and what was found where it does not.
  const whose =
    event.yours === false
      ? `Di chi è: non dell'utente${mark && !mark.yours && mark.setBy === 'utente' ? ', l’ha detto lui' : ': il suo calendario non lo dice suo'}`
      : mark?.yours
        ? `Di chi è: dell'utente, ${mark.setBy === 'utente' ? 'l’ha detto lui' : 'l’hai riconosciuto tu'}${mark.reason ? ` («${mark.reason}»)` : ''}`
        : ''

  return {
    content: [
      `${handle} · ${event.title}`,
      `Quando: ${eventWhen(event.start, event.end, event.allDay)}`,
      `Calendario: ${event.calendarName}`,
      event.location ? `Dove: ${event.location}` : '',
      event.organizer ? `Organizzatore: ${event.organizer}` : '',
      event.creator && event.creator !== event.organizer
        ? `Messo nel calendario da: ${event.creator}`
        : '',
      whose,
      event.attendees.length > 0
        ? `Invitati: ${event.attendees.map((attendee) => `${attendee.name ?? attendee.email} (${attendee.response})`).join(', ')}`
        : '',
      event.myResponse ? `La risposta dell'utente: ${event.myResponse}` : '',
      event.meetLink ? `Call: ${event.meetLink}` : '',
      event.description ? `\n${clip(event.description, 6000).text}` : '',
      ...(projects.get(eventKey) ?? []).map(
        (project) =>
          `Progetto: ${context.handles.name(
            { kind: 'project', projectId: project.id, title: project.title },
            context.newHandles
          )} ${project.title}`
      ),
      prep ? `\nLa preparazione che hai scritto:\n${unlinked(prep.text)}` : '',
      alerts.length > 0
        ? `\nGli avvisi che ne hai dato all'utente:\n${alerts.map((alert) => `  ${formatDateTime(new Date(alert.toldAt).toISOString())} · «${alert.text}»${alert.delivered ? '' : ' (non gli è arrivato)'}`).join('\n')}`
        : '',
      items.length > 0
        ? `\nCose aperte nate da questo evento (e chiuse di recente):\n${items.map((item) => `  ${commitmentLine(item)}`).join('\n')}`
        : ''
    ]
      .filter(Boolean)
      .join('\n'),
    summary: `Letto l'evento «${event.title}»`
  }
}

/** What reading a project needs: the mail, the registry, the run's names and what it saw. */
export type ProjectReader = Pick<
  ToolContext,
  'mail' | 'calendar' | 'registry' | 'handles' | 'newHandles'
> & {
  run: Pick<ToolContext['run'], 'seen'>
}

export async function readProject(
  context: ProjectReader,
  projectId: string,
  page = 1
): Promise<ToolOutcome> {
  const project = await context.registry.projects.summary(projectId)

  if (!project) {
    throw new ToolInputError('Questo progetto non esiste più.')
  }

  const accountIds = (await context.mail.listAccounts()).map((account) => account.id)
  const threads = await context.registry.projects.threadsOf(projectId, accountIds)
  const [notes, resources] = await Promise.all([
    context.registry.notes.ofThreads(threads),
    context.registry.projects.resources(projectId)
  ])
  const eventKeys = resources
    .filter((resource) => resource.kind === 'evento')
    .map((resource) => resource.location)
  const [items, events] = await Promise.all([
    context.registry.commitments.ofPlaces({ threads, events: eventKeys, projects: [projectId] }),
    Promise.all(eventKeys.map((key) => context.calendar.event(key)))
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

  const first = (Math.max(1, page) - 1) * PROJECT_CONVERSATIONS_SHOWN
  const rest = conversations.length - first - PROJECT_CONVERSATIONS_SHOWN

  for (const note of conversations.slice(first, first + PROJECT_CONVERSATIONS_SHOWN)) {
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
        ? `Il punto (scritto il ${shortDate(new Date(project.stateAt ?? project.updatedAt).toISOString())}${project.staleSince ? ', poi qualcosa si è mosso: va aggiornato' : ''}):\n${unlinked(project.state)}`
        : 'Il punto: non ancora scritto.',
      resources.some((resource) => resource.kind !== 'evento')
        ? `Risorse: ${resources
            .filter((resource) => resource.kind !== 'evento')
            .map((resource) => `${resource.label ?? ''} ${resource.location}`.trim())
            .join(' · ')}`
        : '',
      eventKeys.length > 0
        ? `Eventi:\n${events
            .map((event, index) =>
              event
                ? `  ${context.handles.name(
                    { kind: 'event', eventKey: event.key, title: event.title },
                    context.newHandles
                  )} · ${event.allDay ? event.start : formatDateTime(event.start)} · ${event.title}`
                : `  ${resources.find((resource) => resource.location === eventKeys[index])?.label ?? 'un evento'} · non più nel calendario`
            )
            .join('\n')}`
        : '',
      items.length > 0
        ? `Cose aperte (e chiuse di recente):\n${items.map((item) => `  ${commitmentLine(item)}`).join('\n')}`
        : 'Niente di aperto.',
      `Conversazioni, dalla più recente${conversations.length > PROJECT_CONVERSATIONS_SHOWN ? ` (${conversations.length}; dalla ${first + 1}ª)` : ''}:\n${lines.join('\n') || '(nessuna)'}${rest > 0 ? `\n[Altre ${rest}: continua con pagina=${Math.max(1, page) + 1}.]` : ''}`
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
      pagina: { type: 'integer' },
      guarda: { type: 'boolean' }
    },
    required: ['cosa']
  },
  running: (args) => (booleanArg(args, 'conversazione') ? 'Leggo la conversazione…' : 'Leggo…'),
  readsOnly: () => true,
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
            page: numberArg(args, 'pagina'),
            look: booleanArg(args, 'guarda')
          })
        )
      }
      case 'event':
        return readEvent(context, reference, target.eventKey)
      case 'project':
        return readProject(context, target.projectId, numberArg(args, 'pagina') ?? 1)
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
        throw new UnknownHandle(
          `Non conosco «${reference}»: in questa conversazione non l'hai ricevuto. I riferimenti (m…, f…, e…, p…, b…) arrivano dagli strumenti: un messaggio da \`cerca_posta\`, un progetto da \`progetti\`, un evento da \`calendario\`. Un file si legge anche dal suo percorso completo.`
        )
    }
  }
}
