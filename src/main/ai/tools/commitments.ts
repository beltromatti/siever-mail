import { defineMessages } from '@shared/i18n'

import { messages } from '../../i18n'
import type { CommitmentKind, CommitmentOrigin, CommitmentRecord } from '../registry/types'
import { RegistryRefusal, RevisionConflict } from '../registry/types'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  objectListArg,
  requireString,
  seenKey,
  seenOf,
  stringArg,
  numberArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  UnknownHandle
} from '../agent/tool-types'
import { evidenceOf, resolveEvent, resolveSentOrReceived } from './anchors'
import { commitmentLine, rememberCommitments } from './describe'
import { countOf, shortDate } from './format'
import { projectOf } from './projects'

/** The step's lines, as the user sees them in the panel. */
const STEPS = defineMessages({
  running: {
    en: 'Updating the open items…',
    it: 'Aggiorno le cose aperte…',
    de: 'Aktualisiere die offenen Punkte…'
  },
  changed: {
    en: (changed: number, failures: number) =>
      `Open items: ${changed === 1 ? '1 change' : `${changed} changes`}${failures > 0 ? ` · ${failures} not done` : ''}`,
    it: (changed: number, failures: number) =>
      `Cose aperte: ${changed === 1 ? '1 modifica' : `${changed} modifiche`}${failures > 0 ? ` · ${failures} non fatte` : ''}`,
    de: (changed: number, failures: number) =>
      `Offene Punkte: ${changed === 1 ? '1 Änderung' : `${changed} Änderungen`}${failures > 0 ? ` · ${failures} nicht erledigt` : ''}`
  },
  failed: {
    en: (failures: number) => `Open items: ${failures} not done`,
    it: (failures: number) => `Cose aperte: ${failures} non fatte`,
    de: (failures: number) => `Offene Punkte: ${failures} nicht erledigt`
  },
  looked: {
    en: 'Looked at the open items',
    it: 'Guardate le cose aperte',
    de: 'Offene Punkte angesehen'
  }
})

const KINDS: ReadonlyArray<CommitmentKind> = ['ti_chiedono', 'hai_promesso', 'aspetti', 'da_fare']
/** A note's nature where a commitment's kind is meant: the two words are near, the meaning the same. */
const KIND_OF_NATURE: Readonly<Record<string, CommitmentKind>> = {
  da_rispondere: 'ti_chiedono',
  in_attesa: 'aspetti'
}

/** The kind of a commitment, also when written as a note's nature. */
function kindArg(args: Record<string, unknown>): CommitmentKind | undefined {
  const written = stringArg(args, 'tipo')?.trim().toLowerCase()

  if (!written) {
    return undefined
  }

  const kind = (KIND_OF_NATURE[written] ?? written) as CommitmentKind

  if (!KINDS.includes(kind)) {
    throw new ToolInputError(`\`tipo\` è uno di: ${KINDS.join(', ')}.`)
  }

  return kind
}

/** A nullable day argument: AAAA-MM-GG, or nothing. */
export function dayArg(args: Record<string, unknown>, name: string): string | null {
  const value = stringArg(args, name)
  return value && value !== 'null' ? value : null
}

type Operation = Record<string, unknown>

/** Carries out one operation on the commitments; a line on how it went. */
async function runOperation(context: ToolContext, operation: Operation): Promise<string> {
  const action = requireString(operation, 'azione')
  const actor = context.run.actor
  const id = numberArg(operation, 'id')
  const reason = stringArg(operation, 'motivo') ?? null
  // The message that proves a change — read where a change takes one, not when opening.
  const evidence = (): ReturnType<typeof evidenceOf> =>
    evidenceOf(context, stringArg(operation, 'prova'))
  // What the run saw of the thing it changes — never seen, it is shown first (§4.6).
  const seenRevision = id !== undefined ? seenOf(context.run, seenKey('item', id)) : undefined
  const remember = (record: CommitmentRecord): void => {
    context.run.seen.set(seenKey('item', record.id), record.revision)
  }
  const needId = (): number => {
    if (id === undefined) {
      throw new ToolInputError(`Per «${action}» serve \`id\`, il numero della cosa (#12 → 12).`)
    }

    return id
  }

  switch (action) {
    case 'apri': {
      const kind = kindArg(operation)
      const text = stringArg(operation, 'testo')?.trim()

      if (!kind || !text) {
        throw new ToolInputError(
          `Per aprire una cosa servono \`tipo\` (${KINDS.join(', ')}) e \`testo\`: rifai l'operazione per intero, con il posto da cui nasce.`
        )
      }

      const projectId = await projectArg(context, operation)
      const origin = await originOf(context, operation, projectId)
      const { record, created } = await context.registry.openCommitment(
        origin,
        {
          kind,
          text,
          due: dayArg(operation, 'scadenza'),
          question: stringArg(operation, 'domanda') ?? null
        },
        actor
      )
      remember(record)
      const filed = projectId ? await fileSource(context, origin, projectId) : ''

      return `${created ? 'Aperta' : 'Già aperta:'} ${commitmentLine(record)}${filed}`
    }
    case 'aggiorna': {
      const projectId = await projectArg(context, operation)
      const current = await context.registry.commitments.get(needId())
      // The place it comes from, put right when given: the message or the event it is about —
      // or, for the user's word, the project it is about.
      const placed =
        stringArg(operation, 'messaggio') || stringArg(operation, 'evento')
          ? await originOf(context, operation, projectId)
          : projectId && current?.origin.kind === 'utente'
            ? ({ kind: 'utente', projectId } as const)
            : undefined
      const { record } = await context.registry.editCommitment(
        needId(),
        {
          text: stringArg(operation, 'testo'),
          due: operation.scadenza === undefined ? undefined : dayArg(operation, 'scadenza'),
          kind: kindArg(operation),
          origin: placed,
          question:
            operation.domanda === undefined ? undefined : (stringArg(operation, 'domanda') ?? null)
        },
        actor,
        { seenRevision, evidence: await evidence(), reason: reason ?? undefined }
      )
      remember(record)
      const filed = projectId ? await fileSource(context, record.origin, projectId) : ''
      return `Aggiornata ${commitmentLine(record)}${filed}`
    }
    case 'fatta':
    case 'non_serve':
    case 'riapri':
    case 'rinvia': {
      const status = action === 'riapri' ? 'aperta' : action === 'rinvia' ? 'rinviata' : action
      const { record, change } = await context.registry.setCommitmentStatus(
        needId(),
        status,
        actor,
        {
          seenRevision,
          evidence: await evidence(),
          reason,
          until: dayArg(operation, 'fino_a')
        }
      )
      remember(record)

      return change ? commitmentLine(record) : `Era già così: ${commitmentLine(record)}`
    }
    case 'chiedi': {
      const { record } = await context.registry.editCommitment(
        needId(),
        { question: requireString(operation, 'domanda') },
        actor,
        { seenRevision }
      )
      remember(record)
      return `Chiederai all'utente: ${commitmentLine(record)}`
    }
    case 'unisci': {
      const keep = needId()
      const raw = operation.con
      const listed: unknown[] = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
          ? raw.split(/[,\s]+/)
          : typeof raw === 'number'
            ? [raw]
            : []
      const others = listed
        .map((value) => Number(String(value).replace('#', '')))
        .filter((value) => Number.isInteger(value) && value > 0 && value !== keep)

      if (others.length === 0) {
        throw new ToolInputError('Per unire indica in `con` i numeri delle cose uguali a `id`.')
      }

      await context.registry.mergeCommitments(keep, [...new Set(others)], actor)

      // Closed by this run: as it left them.
      for (const record of await context.registry.commitments.many(others)) {
        remember(record)
      }

      return `Unite in #${keep}: ${others.map((other) => `#${other}`).join(', ')}`
    }
    default:
      throw new ToolInputError(
        `Azione sconosciuta «${action}»: apri, aggiorna, fatta, non_serve, rinvia, riapri, chiedi, unisci, elenco.`
      )
  }
}

/** The project an operation names, by its short name or its name; undefined when it names none. */
async function projectArg(context: ToolContext, operation: Operation): Promise<string | undefined> {
  const written = stringArg(operation, 'progetto')?.trim()

  if (!written) {
    return undefined
  }

  if (/^[me]\d+$/i.test(written)) {
    throw new ToolInputError(
      `\`progetto\` è un progetto (p…): ${written} è ${written.toLowerCase().startsWith('m') ? 'un messaggio, va in `messaggio`' : 'un evento, va in `evento`'}.`
    )
  }

  return projectOf(context, operation)
}

/**
 * Where a new open thing comes from: the message given, the event given —
 * or the one given as its proof, which is where it was read — or, none of
 * them, the user's word (about `projectId`, if given), which only a
 * conversation with the user can hear: alone, the Segretario opens things
 * from what it reads.
 */
async function originOf(
  context: ToolContext,
  operation: Operation,
  projectId?: string
): Promise<CommitmentOrigin & { dateIso?: string }> {
  const proof = stringArg(operation, 'prova')?.trim()
  const messageHandle =
    stringArg(operation, 'messaggio') ||
    (!stringArg(operation, 'evento') && proof && /^m\d+$/i.test(proof) ? proof : undefined)
  const eventHandle =
    stringArg(operation, 'evento') ||
    (!messageHandle && proof && /^e\d+$/i.test(proof) ? proof : undefined)

  if (stringArg(operation, 'messaggio') && stringArg(operation, 'evento')) {
    throw new ToolInputError(
      'Una cosa aperta nasce da un posto solo: `messaggio` oppure `evento`. Se riguarda anche l’altro, dillo nel testo.'
    )
  }

  if (messageHandle) {
    const message = await resolveSentOrReceived(context, messageHandle)
    return {
      kind: 'messaggio',
      accountId: message.accountId,
      threadId: message.threadId,
      messageKey: message.messageKey,
      dateIso: message.dateIso
    }
  }

  if (eventHandle) {
    return { kind: 'evento', eventKey: resolveEvent(context, eventHandle).eventKey }
  }

  if (context.run.actor.background) {
    throw new ToolInputError(
      "Lavorando da solo, una cosa aperta nasce da ciò che leggi: indica il `messaggio` (m…) o l'`evento` (e…) da cui viene, e rifai l'operazione per intero, con `tipo` e `testo`."
    )
  }

  return projectId ? { kind: 'utente', projectId } : { kind: 'utente' }
}

/**
 * A thing said to stand in a project: its message's conversation, or its
 * event, filed there too — the project gathers its things by their source
 * (the user's word carries the project itself). A line on what was filed,
 * or on why it was not.
 */
async function fileSource(
  context: ToolContext,
  origin: CommitmentOrigin,
  projectId: string
): Promise<string> {
  const project = await context.registry.projects.get(projectId)
  const title = project?.title ?? 'il progetto'

  try {
    if (origin.kind === 'messaggio') {
      const change = await context.registry.linkThread(projectId, origin, context.run.actor)
      return change ? ` · conversazione collegata a ${title}` : ` · in ${title}`
    }

    if (origin.kind === 'evento') {
      const linked = (await context.registry.projects.resources(projectId)).some(
        (resource) => resource.kind === 'evento' && resource.location === origin.eventKey
      )

      if (!linked) {
        const event = await context.calendar.event(origin.eventKey)
        await context.registry.addProjectResource(
          projectId,
          { kind: 'evento', location: origin.eventKey, label: event?.title ?? null },
          context.run.actor
        )
        return ` · evento collegato a ${title}`
      }

      return ` · in ${title}`
    }

    return ` · in ${title}`
  } catch (error) {
    if (error instanceof RegistryRefusal) {
      return ` · non messa in ${title}: ${error.message}`
    }

    throw error
  }
}

/** How far back `chiuse` looks. */
const RECENTLY_CLOSED_MS = 14 * 24 * 60 * 60 * 1000

/** How far back, and over how many conversations, what is open with a person is looked for. */
const PERSON_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000
const PERSON_CONVERSATIONS = 50

/** The conversations, in every account, with mail from this address. */
async function conversationsWith(
  context: ToolContext,
  address: string
): Promise<Array<{ accountId: string; threadId: string }>> {
  const since = new Date(Date.now() - PERSON_LOOKBACK_MS).toISOString()
  const accounts = await context.mail.listAccounts()
  const found = await Promise.all(
    accounts.map(async (account) =>
      (await context.mail.threadsFromSender(account.id, address, since, PERSON_CONVERSATIONS)).map(
        (threadId) => ({ accountId: account.id, threadId })
      )
    )
  )
  return found.flat()
}

/**
 * Where each of these things comes from, in words with a short name to
 * open it: the message (and whether it lies in the Trash), the event, or
 * the user's word.
 */
async function sourceWords(
  context: ToolContext,
  records: ReadonlyArray<CommitmentRecord>
): Promise<Map<number, string>> {
  const words = new Map<number, string>()
  const byAccount = new Map<string, Array<{ id: number; messageKey: string }>>()
  const eventKeys = new Set<string>()

  for (const record of records) {
    const { origin } = record

    if (origin.kind === 'messaggio') {
      byAccount.set(origin.accountId, [
        ...(byAccount.get(origin.accountId) ?? []),
        { id: record.id, messageKey: origin.messageKey }
      ])
    } else if (origin.kind === 'evento') {
      eventKeys.add(origin.eventKey)
    } else {
      words.set(record.id, "detta dall'utente")
    }
  }

  for (const [accountId, wanted] of byAccount) {
    const located = await context.mail.locate(
      accountId,
      wanted.map((entry) => entry.messageKey)
    )

    for (const { id, messageKey } of wanted) {
      const location = located.get(messageKey)

      if (!location) {
        words.set(id, 'da un messaggio non più nella posta')
        continue
      }

      const handle = context.handles.name(
        { kind: 'message', ref: location.ref, messageKey },
        context.newHandles
      )
      words.set(
        id,
        `da ${handle} «${location.subject}»${location.setAside ? ' · messaggio nel cestino: sospesa' : ''}`
      )
    }
  }

  const events = new Map(
    await Promise.all(
      [...eventKeys].map(async (key) => [key, await context.calendar.event(key)] as const)
    )
  )

  for (const record of records) {
    if (record.origin.kind === 'evento') {
      const event = events.get(record.origin.eventKey)
      words.set(
        record.id,
        event
          ? `dall'evento ${context.handles.name(
              { kind: 'event', eventKey: event.key, title: event.title },
              context.newHandles
            )} «${event.title}» del ${shortDate(event.start)}`
          : 'da un evento non più nel calendario'
      )
    }
  }

  return words
}

async function listCommitments(context: ToolContext, filter: Operation): Promise<string> {
  const kind = kindArg(filter)
  const projectHandle = stringArg(filter, 'progetto')
  const project = projectHandle ? context.handles.project(projectHandle) : null

  if (projectHandle && !project) {
    throw new UnknownHandle(`Non conosco il progetto «${projectHandle}».`)
  }

  const person = stringArg(filter, 'persona')?.trim().toLowerCase()
  let threads = project ? await context.registry.projects.threadsOf(project.projectId) : undefined
  // A project's things come from its conversations and from its events; a person's, from the
  // conversations with them.
  const events =
    project && !person
      ? (await context.registry.projects.resources(project.projectId))
          .filter((resource) => resource.kind === 'evento')
          .map((resource) => resource.location)
      : undefined

  if (person) {
    const withPerson = await conversationsWith(context, person)
    const kept = threads
      ? threads.filter((thread) =>
          withPerson.some(
            (other) => other.accountId === thread.accountId && other.threadId === thread.threadId
          )
        )
      : withPerson

    if (kept.length === 0) {
      return `Nessuna conversazione con ${person}${project ? ' in questo progetto' : ''}${
        person.includes('@') ? '' : ' (`persona` è un indirizzo email: cercalo con cerca_posta)'
      }.`
    }

    threads = kept
  }

  // What the user said about the project stands in it too.
  const projects = project && !person ? [project.projectId] : undefined
  const open = await context.registry.commitments.open({
    kinds: kind ? [kind] : undefined,
    dueBy: stringArg(filter, 'entro'),
    threads,
    events,
    projects,
    includeDeferred: true
  })
  // Closed lately too, when asked: what was done or not needed is not to be opened again.
  const closed = booleanArg(filter, 'chiuse')
    ? await context.registry.commitments.closedSince(Date.now() - RECENTLY_CLOSED_MS, {
        threads,
        events,
        projects,
        kinds: kind ? [kind] : undefined
      })
    : []
  const records = [...open, ...closed]
  rememberCommitments(context, records)

  if (records.length === 0) {
    return closed.length === 0 && booleanArg(filter, 'chiuse')
      ? 'Niente di aperto, né chiuso di recente, con questi criteri.'
      : 'Niente di aperto con questi criteri.'
  }

  const sources = await sourceWords(context, records)
  const line = (record: CommitmentRecord): string =>
    `${commitmentLine(record)} · ${sources.get(record.id) ?? ''}`

  return [
    open.length > 0
      ? `${countOf(open.length, 'cosa aperta', 'cose aperte')}, le più vicine per prime:\n${open.map(line).join('\n')}`
      : 'Niente di aperto con questi criteri.',
    closed.length > 0
      ? `Chiuse negli ultimi 14 giorni, le più recenti per prime:\n${closed.map(line).join('\n')}`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const commitmentsTool: SegretarioTool = {
  name: 'impegni',
  description: PROMPTS.tools.impegni,
  parameters: {
    type: 'object',
    properties: {
      operazioni: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            azione: {
              type: 'string',
              enum: [
                'elenco',
                'apri',
                'aggiorna',
                'fatta',
                'non_serve',
                'rinvia',
                'riapri',
                'chiedi',
                'unisci'
              ]
            },
            id: { type: 'integer' },
            messaggio: { type: 'string' },
            evento: { type: 'string' },
            tipo: { type: 'string', enum: [...KINDS] },
            testo: { type: 'string' },
            scadenza: { type: ['string', 'null'] },
            fino_a: { type: 'string' },
            motivo: { type: 'string' },
            prova: { type: 'string' },
            domanda: { type: 'string' },
            con: { type: 'array', items: { type: 'integer' } },
            entro: { type: 'string' },
            progetto: { type: 'string' },
            persona: { type: 'string' },
            chiuse: { type: 'boolean' }
          },
          required: ['azione']
        }
      }
    },
    required: ['operazioni']
  },
  running: () => messages(STEPS).running,
  readsOnly: (args) =>
    Array.isArray(args.operazioni) &&
    args.operazioni.every(
      (operation) =>
        operation !== null &&
        typeof operation === 'object' &&
        (operation as Record<string, unknown>).azione === 'elenco'
    ),
  async execute(args, context) {
    const operations = objectListArg(args, 'operazioni')

    if (operations.length === 0) {
      throw new ToolInputError('Indica almeno un’operazione in `operazioni`.')
    }

    const lines: string[] = []
    let failures = 0
    let conflicts = 0

    for (const [index, operation] of operations.entries()) {
      try {
        lines.push(
          stringArg(operation, 'azione') === 'elenco'
            ? await listCommitments(context, operation)
            : await runOperation(context, operation)
        )
      } catch (error) {
        if (error instanceof RevisionConflict) {
          // Seen as it is now: the same operation may be made again, knowingly.
          rememberCommitments(context, [error.current as CommitmentRecord])
          failures += 1
          conflicts += 1
          lines.push(`Operazione ${index + 1} non fatta: ${error.message}`)
        } else if (error instanceof RegistryRefusal || error instanceof ToolInputError) {
          failures += 1
          lines.push(`Operazione ${index + 1} non fatta: ${error.message}`)
        } else {
          throw error
        }
      }
    }

    const changed =
      operations.filter((operation) => stringArg(operation, 'azione') !== 'elenco').length -
      failures

    return {
      content: lines.join('\n'),
      summary:
        changed > 0
          ? messages(STEPS).changed(changed, failures)
          : failures > 0
            ? messages(STEPS).failed(failures)
            : messages(STEPS).looked,
      failed: failures === operations.length && conflicts === 0
    }
  }
}
