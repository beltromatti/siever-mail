import type { CommitmentKind, CommitmentRecord, NoteNature, NotePriority } from '../registry/types'
import { RegistryRefusal } from '../registry/types'
import { PROMPTS } from '../prompts'
import {
  objectListArg,
  requireString,
  seenKey,
  stringArg,
  numberArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { evidenceOf, resolveSentOrReceived } from './anchors'
import { commitmentLine, rememberCommitments } from './describe'
import { countOf } from './format'

const NATURES: ReadonlyArray<NoteNature> = [
  'da_rispondere',
  'da_fare',
  'in_attesa',
  'informativo',
  'rumore'
]
const PRIORITIES: ReadonlyArray<NotePriority> = ['alta', 'media', 'bassa']
const KINDS: ReadonlyArray<CommitmentKind> = ['ti_chiedono', 'hai_promesso', 'aspetti', 'da_fare']

/** A nullable day argument: AAAA-MM-GG, or nothing. */
function dayArg(args: Record<string, unknown>, name: string): string | null {
  const value = stringArg(args, name)
  return value && value !== 'null' ? value : null
}

export const noteTool: SegretarioTool = {
  name: 'nota',
  description: PROMPTS.tools.nota,
  parameters: {
    type: 'object',
    properties: {
      messaggio: { type: 'string' },
      sintesi: { type: 'string' },
      natura: { type: 'string', enum: [...NATURES] },
      importanza: { type: 'string', enum: [...PRIORITIES] },
      motivo: { type: 'string' },
      scadenza: { type: ['string', 'null'] }
    },
    required: ['messaggio', 'sintesi', 'natura', 'importanza', 'motivo']
  },
  running: () => 'Annoto…',
  async execute(args, context) {
    const handle = requireString(args, 'messaggio')
    const message = await resolveSentOrReceived(context, handle)
    const nature = requireString(args, 'natura') as NoteNature
    const priority = requireString(args, 'importanza') as NotePriority

    try {
      const { record, change } = await context.registry.writeNote(
        { ...message, messageDate: message.dateIso },
        {
          summary: requireString(args, 'sintesi'),
          nature,
          priority,
          reason: stringArg(args, 'motivo') ?? '',
          due: dayArg(args, 'scadenza')
        },
        context.run.actor,
        {
          seenRevision: context.run.seen.get(seenKey('note', message.accountId, message.messageKey))
        }
      )
      context.run.seen.set(seenKey('note', message.accountId, message.messageKey), record.revision)

      return {
        content: `Nota di ${handle} ${change.action === 'scritta' ? 'scritta' : 'corretta'}.`,
        summary: change.label,
        messages: [message.ref]
      }
    } catch (error) {
      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}

type Operation = Record<string, unknown>

/** Carries out one operation on the commitments; a line on how it went. */
async function runOperation(context: ToolContext, operation: Operation): Promise<string> {
  const action = requireString(operation, 'azione')
  const actor = context.run.actor
  const id = numberArg(operation, 'id')
  const reason = stringArg(operation, 'motivo') ?? null
  const evidence = await evidenceOf(context, stringArg(operation, 'prova'))
  const seenRevision = id !== undefined ? context.run.seen.get(seenKey('item', id)) : undefined
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
      const handle = requireString(operation, 'messaggio')
      const kind = requireString(operation, 'tipo') as CommitmentKind

      if (!KINDS.includes(kind)) {
        throw new ToolInputError(`\`tipo\` è uno di: ${KINDS.join(', ')}.`)
      }

      const message = await resolveSentOrReceived(context, handle)
      const { record, created } = await context.registry.openCommitment(
        message,
        {
          kind,
          text: requireString(operation, 'testo'),
          due: dayArg(operation, 'scadenza'),
          question: stringArg(operation, 'domanda') ?? null
        },
        actor
      )
      remember(record)

      return created ? `Aperta ${commitmentLine(record)}` : `Già aperta: ${commitmentLine(record)}`
    }
    case 'aggiorna': {
      const { record } = await context.registry.editCommitment(
        needId(),
        {
          text: stringArg(operation, 'testo'),
          due: operation.scadenza === undefined ? undefined : dayArg(operation, 'scadenza'),
          kind: stringArg(operation, 'tipo') as CommitmentKind | undefined,
          question:
            operation.domanda === undefined ? undefined : (stringArg(operation, 'domanda') ?? null)
        },
        actor,
        { seenRevision, evidence, reason: reason ?? undefined }
      )
      remember(record)
      return `Aggiornata ${commitmentLine(record)}`
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
          evidence,
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
      return `Unite in #${keep}: ${others.map((other) => `#${other}`).join(', ')}`
    }
    default:
      throw new ToolInputError(
        `Azione sconosciuta «${action}»: apri, aggiorna, fatta, non_serve, rinvia, riapri, chiedi, unisci, elenco.`
      )
  }
}

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

async function listCommitments(context: ToolContext, filter: Operation): Promise<string> {
  const kind = stringArg(filter, 'tipo') as CommitmentKind | undefined
  const projectHandle = stringArg(filter, 'progetto')
  const project = projectHandle ? context.handles.project(projectHandle) : null

  if (projectHandle && !project) {
    throw new ToolInputError(`Non conosco il progetto «${projectHandle}».`)
  }

  const person = stringArg(filter, 'persona')?.trim().toLowerCase()
  let threads = project ? await context.registry.projects.threadsOf(project.projectId) : undefined

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
      return `Nessuna conversazione con ${person}${project ? ' in questo progetto' : ''}.`
    }

    threads = kept
  }

  const records = await context.registry.commitments.open({
    kinds: kind ? [kind] : undefined,
    dueBy: stringArg(filter, 'entro'),
    threads,
    includeDeferred: true
  })
  rememberCommitments(context, records)

  if (records.length === 0) {
    return 'Niente di aperto con questi criteri.'
  }

  const summaries = new Map<string, string>()

  for (const accountId of new Set(records.map((record) => record.accountId))) {
    const keys = records
      .filter((record) => record.accountId === accountId)
      .map((record) => record.messageKey)
    const located = await context.mail.locate(accountId, keys)

    for (const [key, location] of located) {
      const handle = context.handles.name(
        { kind: 'message', ref: location.ref, messageKey: key },
        context.newHandles
      )
      summaries.set(
        `${accountId}\u0000${key}`,
        `${handle} «${location.subject}»${location.setAside ? ' · messaggio nel cestino: sospesa' : ''}`
      )
    }
  }

  return `${countOf(records.length, 'cosa aperta', 'cose aperte')}, le più vicine per prime:\n${records
    .map(
      (record) =>
        `${commitmentLine(record)} · da ${summaries.get(`${record.accountId}\u0000${record.messageKey}`) ?? 'un messaggio non più nella posta'}`
    )
    .join('\n')}`
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
            persona: { type: 'string' }
          },
          required: ['azione']
        }
      }
    },
    required: ['operazioni']
  },
  running: () => 'Aggiorno le cose aperte…',
  async execute(args, context) {
    const operations = objectListArg(args, 'operazioni')

    if (operations.length === 0) {
      throw new ToolInputError('Indica almeno un’operazione in `operazioni`.')
    }

    const lines: string[] = []
    let failures = 0

    for (const [index, operation] of operations.entries()) {
      try {
        lines.push(
          stringArg(operation, 'azione') === 'elenco'
            ? await listCommitments(context, operation)
            : await runOperation(context, operation)
        )
      } catch (error) {
        if (error instanceof RegistryRefusal || error instanceof ToolInputError) {
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
          ? `Cose aperte: ${countOf(changed, 'modifica', 'modifiche')}${failures > 0 ? ` · ${failures} non fatte` : ''}`
          : failures > 0
            ? `Cose aperte: ${failures} non fatte`
            : 'Guardate le cose aperte',
      failed: failures === operations.length
    }
  }
}
