import { pecLabel } from '@shared/pec'
import { accountOverview, type OverviewPerson } from '../mail-overview'
import {
  folderQueryLabel,
  hitsOfRefs,
  searchMail,
  searchScope,
  serverMailboxes,
  unindexedCount
} from '../mail-search'
import { PROMPTS } from '../prompts'
import {
  booleanArg,
  numberArg,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  type ToolOutcome,
  UnknownHandle
} from '../agent/tool-types'
import { countOf, formatAddresses, formatDateTime, shortDate } from './format'

const DEFAULT_SEARCH_LIMIT = 20
const DEFAULT_MONTHS = 12
const DEFAULT_PEOPLE = 20
/** How many hits a search within a project looks through, for the project's to be among them. */
const PROJECT_OVERFETCH = 6

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONTH_LABEL = new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric' })

function personLine(person: OverviewPerson): string {
  const who = person.name ? `${person.name} <${person.address}>` : person.address
  const answered =
    person.answered === undefined
      ? ''
      : person.answered === 0
        ? ' · mai risposto'
        : ` · hai risposto a ${person.answered}`

  return `- ${who} · ${countOf(person.messages, 'messaggio', 'messaggi')}${answered} · ultimo ${shortDate(person.lastIso.slice(0, 10))}`
}

/**
 * Who the mail is with and how it went, month by month — counted from the
 * envelopes, not guessed: who the user writes to and answers is who
 * matters.
 */
async function overview(args: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const accounts = await context.mail.listAccounts()
  const wanted = stringArg(args, 'account')?.toLowerCase()
  const chosen = wanted
    ? accounts.filter((account) => account.email.toLowerCase() === wanted)
    : accounts

  if (chosen.length === 0) {
    throw new ToolInputError(
      `Nessun account «${wanted}». Gli account sono: ${accounts.map((account) => account.email).join(', ')}.`
    )
  }

  const months = Math.max(1, numberArg(args, 'mesi') ?? DEFAULT_MONTHS)
  const people = Math.max(1, numberArg(args, 'limite') ?? DEFAULT_PEOPLE)
  const since = new Date()
  since.setMonth(since.getMonth() - months)
  const sinceIso = since.toISOString()
  // Mail between the user's own accounts is theirs on both sides.
  const own = new Set(accounts.map((account) => account.email.toLowerCase()))
  const prisma = await context.mail.searchClient()
  const sections: string[] = []

  for (const account of chosen) {
    const summary = await accountOverview(
      prisma,
      account,
      await context.mail.listFolders(account.id),
      own,
      sinceIso,
      people
    )

    sections.push(
      [
        `## ${account.email} — ultimi ${countOf(months, 'mese', 'mesi')} (dal ${shortDate(sinceIso.slice(0, 10))})`,
        `Scritti dall'utente: ${summary.sent} · ricevuti: ${summary.received}`,
        '',
        "A chi scrive di più l'utente:",
        ...(summary.writtenTo.length > 0
          ? summary.writtenTo.map(personLine)
          : ['- nessuno in questo periodo']),
        '',
        "Chi scrive di più all'utente:",
        ...(summary.writers.length > 0
          ? summary.writers.map(personLine)
          : ['- nessuno in questo periodo']),
        '',
        'Mese per mese (scritti / ricevuti):',
        summary.months
          .map(
            (month) =>
              `${MONTH_LABEL.format(new Date(Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7)) - 1, 1))} ${month.sent}/${month.received}`
          )
          .join(' · ') || '—'
      ].join('\n')
    )
  }

  return {
    content: sections.join('\n\n'),
    summary: `Guardata la posta ${chosen.length === 1 ? `di ${chosen[0].email}` : 'di tutti gli account'} nel suo insieme · ultimi ${countOf(months, 'mese', 'mesi')}`
  }
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
      progetto: { type: 'string' },
      ovunque: { type: 'boolean' },
      nel_server: { type: 'boolean' },
      quadro: { type: 'boolean' },
      mesi: { type: 'integer' },
      limite: { type: 'integer' }
    }
  },
  running: (args) =>
    booleanArg(args, 'quadro')
      ? 'Guardo la posta nel suo insieme…'
      : stringArg(args, 'testo')
        ? `Cerco «${stringArg(args, 'testo')}»…`
        : 'Cerco nella posta…',
  async execute(args, context) {
    if (booleanArg(args, 'quadro')) {
      return overview(args, context)
    }

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
    const everywhere = booleanArg(args, 'ovunque')
    const scope = searchScope(accounts, folders, {
      accounts: account ? [account] : [],
      folder,
      everywhere
    })

    if (scope.mailboxes.size === 0) {
      throw new ToolInputError(
        account && !accounts.some((item) => item.email.toLowerCase() === account.toLowerCase())
          ? `Nessun account «${account}». Gli account sono: ${accounts.map((item) => item.email).join(', ')}.`
          : `Nessuna cartella «${folder}» negli account indicati.`
      )
    }

    const projectHandle = stringArg(args, 'progetto')
    const project = projectHandle ? context.handles.project(projectHandle) : null

    if (projectHandle && !project) {
      throw new UnknownHandle(
        `Non conosco il progetto «${projectHandle}»: usa un riferimento p… ricevuto.`
      )
    }

    const projectThreads = project
      ? new Set(
          (await context.registry.projects.threadsOf(project.projectId)).map(
            (thread) => `${thread.accountId}\u0000${thread.threadId}`
          )
        )
      : null

    const text = stringArg(args, 'testo')
    const onServer = booleanArg(args, 'nel_server')

    if (onServer && !text) {
      throw new ToolInputError('`nel_server` cerca nel testo dei messaggi: indica `testo`.')
    }

    const unreadOnly = booleanArg(args, 'non_lette')
    const limit = Math.max(1, numberArg(args, 'limite') ?? DEFAULT_SEARCH_LIMIT)
    const prisma = await context.mail.searchClient()
    const query = {
      text,
      from,
      to,
      unreadOnly,
      withAttachments: booleanArg(args, 'con_allegati'),
      limit: projectThreads ? limit * PROJECT_OVERFETCH : limit
    }
    const found = await searchMail(prisma, scope, query)
    // The servers, asked: what they find in the whole text of the messages the cache has not
    // downloaded, after what it found itself.
    const fromServer =
      onServer && text
        ? await hitsOfRefs(
            prisma,
            scope,
            query,
            await context.mail.searchServer(serverMailboxes(scope), text, {
              background: context.run.background
            }),
            new Set(found.map((hit) => `${hit.ref.accountId}\u0000${hit.messageKey}`))
          )
        : []
    const hits = [...found, ...fromServer]
      .filter(
        (hit) => !projectThreads || projectThreads.has(`${hit.ref.accountId}\u0000${hit.threadId}`)
      )
      .slice(0, limit)
    // Not asked of the servers: how many messages here it could find only by their envelope.
    const unindexed = text && !onServer ? await unindexedCount(prisma, scope, query) : 0
    const notDownloaded =
      unindexed > 0
        ? `\n\n[Il testo di ${countOf(unindexed, 'messaggio', 'messaggi')} di queste cartelle e di questo periodo non è ancora scaricato: qui li trovi solo per oggetto, persone e anteprima. Per cercare anche nel loro testo, rifai la ricerca con nel_server: true.]`
        : ''

    // What was looked for, where and when, as the step's line tells it.
    const looked = [
      'Cercato',
      text ? `«${text}»` : unreadOnly ? 'i non letti' : null,
      project ? `nel progetto ${project.title}` : null,
      onServer ? 'anche nei server' : null,
      folder
        ? `in ${folderQueryLabel(folder)}${account ? ` di ${account}` : ''}`
        : account
          ? `nella posta di ${account}`
          : everywhere
            ? 'in tutta la posta, cestino e spam compresi'
            : project
              ? null
              : 'in tutta la posta',
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
      return {
        content: `Nessun messaggio trovato.${notDownloaded}`,
        summary: `${looked} · nessun risultato`
      }
    }

    const notes = await context.registry.notes.many(
      hits.map((hit) => ({ accountId: hit.ref.accountId, messageKey: hit.messageKey }))
    )
    const noteOf = new Map(notes.map((note) => [`${note.accountId}\u0000${note.messageKey}`, note]))
    const lines = hits.map((hit) => {
      const handle = context.handles.name(
        { kind: 'message', ref: hit.ref, messageKey: hit.messageKey },
        context.newHandles
      )
      const note = noteOf.get(`${hit.ref.accountId}\u0000${hit.messageKey}`)
      const flags = [
        hit.pecKind
          ? hit.pecKind === 'busta'
            ? 'PEC'
            : `PEC: ${pecLabel(hit.pecKind).toLowerCase()}`
          : null,
        hit.isRead ? null : 'non letto',
        hit.hasAttachments ? 'con allegati' : null
      ]
        .filter(Boolean)
        .join(', ')

      return [
        `${handle} · ${formatDateTime(hit.date)} · da ${formatAddresses(hit.from, 2)} · a ${formatAddresses([...hit.to, ...hit.cc], 3)}`,
        `   «${hit.subject}» · ${hit.folderLabel} · ${hit.accountEmail}${flags ? ` · ${flags}` : ''}`,
        note
          ? `   La tua nota: ${note.summary}`
          : `   ${hit.snippet.replace(/\s+/g, ' ').trim().slice(0, 320)}`
      ].join('\n')
    })

    return {
      content: `${countOf(hits.length, 'messaggio', 'messaggi')}${text ? ', i più pertinenti per primi' : ', i più recenti per primi'}${
        fromServer.length > 0
          ? `, poi ${countOf(fromServer.length, 'trovato', 'trovati')} dai server`
          : ''
      }${
        hits.length === limit ? ' (potrebbero essercene altri: restringi o alza il limite)' : ''
      }:\n\n${lines.join('\n\n')}${notDownloaded}`,
      summary: `${looked} · ${countOf(hits.length, 'messaggio', 'messaggi')}`,
      messages: hits.map((hit) => hit.ref)
    }
  }
}
