import { isAbsolute } from 'node:path'

import { canonicalPath } from '../../services/network-volumes'
import { searchMail, searchScope } from '../mail-search'
import { linksIn } from '../agent/entries'
import { PROMPTS } from '../prompts'
import {
  RegistryRefusal,
  RevisionConflict,
  type ProjectRecord,
  type ThreadRef
} from '../registry/types'
import {
  booleanArg,
  requireString,
  seenKey,
  stringArg,
  stringListArg,
  ToolConflict,
  ToolInputError,
  type SegretarioTool,
  type ToolContext,
  UnknownHandle
} from '../agent/tool-types'
import { resolveEvent, resolveMessage } from './anchors'
import { projectLine } from './describe'
import { countOf } from './format'

const ACTIONS = [
  'elenco',
  'cerca',
  'crea',
  'collega',
  'scollega',
  'rinomina',
  'descrivi',
  'punto',
  'unisci',
  'nascondi',
  'mostra',
  'concludi',
  'riapri',
  'risorsa'
] as const

/** Conversations a search may file at once into a project. */
const LINKED_BY_SEARCH_MAX = 300

/**
 * The project a call is about: its short name, or its name as the user
 * sees it when only one project is called so. Left out, the one project
 * this run knows, when it knows one.
 */
export async function projectOf(
  context: ToolContext,
  args: Record<string, unknown>,
  name = 'progetto'
): Promise<string> {
  const written = stringArg(args, name)?.trim()
  const named = (project: { id: string; title: string }): string =>
    context.handles.name(
      { kind: 'project', projectId: project.id, title: project.title },
      context.newHandles
    )

  if (!written) {
    const known = context.handles.projects()

    if (known.length === 1) {
      return known[0].projectId
    }

    throw new ToolInputError(
      known.length > 0
        ? `Indica \`${name}\`: ${known.map((project) => `${project.handle} ${project.title}`).join(', ')}.`
        : `Indica \`${name}\`: il riferimento p… di un progetto, da \`progetti\` (\`elenco\` o \`cerca\`).`
    )
  }

  const project = context.handles.project(written)

  if (project) {
    return project.projectId
  }

  const found = await context.registry.projects.search(written)
  const exact = found.filter(
    (candidate) => candidate.title.trim().toLowerCase() === written.toLowerCase()
  )
  const match = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null

  if (match) {
    named(match)
    return match.id
  }

  throw new ToolInputError(
    found.length > 1
      ? `«${written}» può essere più di un progetto: ${found
          .slice(0, 8)
          .map((candidate) => `${named(candidate)} ${candidate.title}`)
          .join(', ')}. Indica il riferimento.`
      : `Nessun progetto «${written}»: cercalo con \`progetti\` (\`cerca\`), o crealo.`
  )
}

/** The conversations of the messages named, and of a search's results, each once. */
async function threadsOf(
  context: ToolContext,
  args: Record<string, unknown>
): Promise<ThreadRef[]> {
  const threads = new Map<string, ThreadRef>()

  for (const handle of stringListArg(args, 'mail')) {
    const message = await resolveMessage(context, handle)
    threads.set(`${message.accountId}\u0000${message.threadId}`, message)
  }

  const query = args.ricerca

  if (query && typeof query === 'object' && !Array.isArray(query)) {
    const search = query as Record<string, unknown>
    const accounts = await context.mail.listAccounts()
    const folders = new Map(
      await Promise.all(
        accounts.map(
          async (account) => [account.id, await context.mail.listFolders(account.id)] as const
        )
      )
    )
    const hits = await searchMail(
      await context.mail.searchClient(),
      searchScope(accounts, folders, {
        accounts: stringArg(search, 'account') ? [stringArg(search, 'account')!] : []
      }),
      {
        text: stringArg(search, 'testo'),
        from: stringArg(search, 'dal'),
        to: stringArg(search, 'al'),
        limit: LINKED_BY_SEARCH_MAX
      }
    )

    if (!stringArg(search, 'testo')) {
      throw new ToolInputError(
        'Una ricerca per collegare ha bisogno di `testo`: senza, collegherebbe tutta la posta.'
      )
    }

    if (hits.length === 0 && threads.size === 0) {
      throw new ToolInputError(
        `La ricerca «${stringArg(search, 'testo')}» non trova messaggi: le parole si cercano dall'inizio («preven» trova «preventivo», non «ventivo»). Prova altre parole, o cerca prima con \`cerca_posta\`.`
      )
    }

    for (const hit of hits) {
      threads.set(`${hit.ref.accountId}\u0000${hit.threadId}`, {
        accountId: hit.ref.accountId,
        threadId: hit.threadId
      })
    }
  }

  return [...threads.values()]
}

/** The revision of a project this run last saw: a write over a newer one is refused. */
function seenOf(context: ToolContext, projectId: string): number | undefined {
  return context.run.seen.get(seenKey('project', projectId))
}

/** A project as this run wrote it: what it has seen now. */
function saw(context: ToolContext, project: { id: string; revision: number }): void {
  context.run.seen.set(seenKey('project', project.id), project.revision)
}

export const projectsTool: SegretarioTool = {
  name: 'progetti',
  description: PROMPTS.tools.progetti,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: [...ACTIONS] },
      progetto: { type: 'string' },
      titolo: { type: 'string' },
      descrizione: { type: 'string' },
      testo: { type: 'string' },
      mail: { type: 'array', items: { type: 'string' } },
      evento: { type: 'array', items: { type: 'string' } },
      ricerca: {
        type: 'object',
        properties: {
          testo: { type: 'string' },
          account: { type: 'string' },
          dal: { type: 'string' },
          al: { type: 'string' }
        }
      },
      con: { type: 'array', items: { type: 'string' } },
      cartella: { type: 'string' },
      etichetta: { type: 'string' },
      togli: { type: 'boolean' },
      cerca: { type: 'string' },
      tutti: { type: 'boolean' }
    },
    required: ['azione']
  },
  running: (args) =>
    args.azione === 'elenco' || args.azione === 'cerca'
      ? 'Guardo i progetti…'
      : 'Aggiorno i progetti…',
  async execute(args, context) {
    const action = requireString(args, 'azione') as (typeof ACTIONS)[number]
    const actor = context.run.actor

    try {
      switch (action) {
        case 'elenco':
        case 'cerca': {
          // The words looked for, however they come: a project named (not a p… reference) is one.
          const named = stringArg(args, 'progetto')
          const query =
            stringArg(args, 'cerca') ??
            (action === 'cerca'
              ? (stringArg(args, 'testo') ??
                stringArg(args, 'titolo') ??
                (named && !context.handles.project(named) ? named : undefined))
              : undefined)

          if (action === 'cerca' && !query) {
            throw new ToolInputError('Indica in `cerca` le parole del progetto che cerchi.')
          }

          const projects = query
            ? await context.registry.projects.search(query)
            : await context.registry.projects.list({
                includeHidden: booleanArg(args, 'tutti'),
                includeClosed: booleanArg(args, 'tutti')
              })

          return {
            content:
              projects.length === 0
                ? query
                  ? `Nessun progetto con «${query}».`
                  : 'Nessun progetto ancora.'
                : `${countOf(projects.length, 'progetto', 'progetti')}, i più mossi di recente per primi:\n${projects
                    .map((project) => projectLine(context, project))
                    .join('\n')}`,
            summary: query ? `Cercato «${query}» tra i progetti` : 'Guardati i progetti'
          }
        }
        case 'crea': {
          const { record, created } = await context.registry.createProject(
            requireString(args, 'titolo'),
            actor,
            {
              description: stringArg(args, 'descrizione') ?? null
            }
          )
          const handle = context.handles.name(
            { kind: 'project', projectId: record.id, title: record.title },
            context.newHandles
          )
          const threads = await threadsOf(context, args)
          let linked = 0

          for (const thread of threads) {
            const change = await context.registry
              .linkThread(record.id, thread, actor)
              .catch((error: unknown) => {
                if (error instanceof RegistryRefusal) {
                  return null
                }

                throw error
              })

            if (change) {
              linked += 1
            }
          }

          // One there already may be set aside: said, for the conversations not to go into it unseen.
          const aside = [
            record.closedAt
              ? record.closedBy === 'utente'
                ? "concluso dall'utente"
                : 'concluso'
              : '',
            record.hiddenAt ? 'nascosto' : ''
          ]
            .filter(Boolean)
            .join(' e ')

          return {
            content: `${created ? 'Creato' : 'Esisteva già'} ${handle} ${record.title}${aside ? ` — è ${aside}: \`riapri\` o \`mostra\` solo se la questione è ripresa davvero` : ''}${linked > 0 ? `, con ${countOf(linked, 'conversazione', 'conversazioni')}` : ''}.`,
            summary: `${created ? 'Nuovo progetto' : 'Progetto'}: ${record.title}`
          }
        }
        case 'collega':
        case 'scollega': {
          // A project looked for by name where its reference belongs (`cerca`): the one it names.
          const named = stringArg(args, 'cerca')
          const projectId = await projectOf(
            context,
            !stringArg(args, 'progetto') && named ? { ...args, progetto: named } : args
          )
          const events = stringListArg(args, 'evento').map((handle) =>
            resolveEvent(context, handle)
          )
          const threads =
            events.length > 0 && !args.mail && !args.ricerca ? [] : await threadsOf(context, args)

          if (threads.length === 0 && events.length === 0) {
            throw new ToolInputError(
              'Indica cosa: le conversazioni con `mail` (riferimenti m…) o `ricerca`, gli eventi con `evento` (riferimenti e…).'
            )
          }

          // An event is gathered as what the project holds besides its conversations.
          for (const event of events) {
            if (action === 'collega') {
              await context.registry.addProjectResource(
                projectId,
                { kind: 'evento', location: event.eventKey, label: event.title },
                actor
              )
            } else {
              await context.registry.removeProjectResource(projectId, event.eventKey, actor)
            }
          }

          let done = 0
          const refused: string[] = []

          for (const thread of threads) {
            try {
              const change =
                action === 'collega'
                  ? await context.registry.linkThread(projectId, thread, actor)
                  : await context.registry.unlinkThread(projectId, thread, actor)

              if (change) {
                done += 1
              }
            } catch (error) {
              if (!(error instanceof RegistryRefusal)) {
                throw error
              }

              refused.push(error.message)
            }
          }

          const project = await context.registry.projects.get(projectId)
          const what = [
            ...(threads.length > 0 ? [countOf(done, 'conversazione', 'conversazioni')] : []),
            ...(events.length > 0 ? [countOf(events.length, 'evento', 'eventi')] : [])
          ].join(' e ')
          return {
            content: `${action === 'collega' ? 'Messi' : 'Tolti'}: ${what}${
              refused.length > 0 ? `. Non fatte: ${[...new Set(refused)].join(' ')}` : '.'
            }`,
            summary: `${action === 'collega' ? 'In' : 'Tolti da'} ${project?.title ?? 'un progetto'}: ${what}`
          }
        }
        case 'rinomina': {
          const id = await projectOf(context, args)
          const record = await context.registry.renameProject(
            id,
            requireString(args, 'titolo'),
            actor,
            seenOf(context, id)
          )
          saw(context, record)
          return {
            content: `Ora si chiama «${record.title}».`,
            summary: `Progetto rinominato: ${record.title}`
          }
        }
        case 'descrivi': {
          const id = await projectOf(context, args)
          const record = await context.registry.describeProject(
            id,
            requireString(args, 'descrizione'),
            actor,
            seenOf(context, id)
          )
          saw(context, record)
          return {
            content: `Descrizione di ${record.title} aggiornata.`,
            summary: `Di cosa si tratta: ${record.title}`
          }
        }
        case 'punto': {
          const id = await projectOf(context, args)
          const text = requireString(args, 'testo')
          // What moved in the project after the run began, it may not have seen — unless the move was its own.
          const basisAt = context.run.changes.some((change) => change.projectIds.includes(id))
            ? Date.now()
            : context.run.startedAt
          const record = await context.registry.setProjectState(
            id,
            text,
            linksIn(text, context.handles),
            basisAt,
            actor,
            seenOf(context, id)
          )
          saw(context, record)
          return {
            content: `Il punto di ${record.title} aggiornato.`,
            summary: `Il punto: ${record.title}`
          }
        }
        case 'unisci': {
          const keepId = await projectOf(context, args)
          const others = stringListArg(args, 'con').map((handle) => {
            const project = context.handles.project(handle)

            if (!project) {
              throw new UnknownHandle(`Non conosco il progetto «${handle}».`)
            }

            return project.projectId
          })

          if (others.length === 0) {
            throw new ToolInputError('Indica in `con` i progetti da unire a `progetto`.')
          }

          if (context.run.background) {
            for (const id of [keepId, ...others]) {
              const project = await context.registry.projects.get(id)

              if (project && (project.origin === 'utente' || project.titleBy === 'utente')) {
                throw new ToolInputError(
                  `«${project.title}» l'ha fatto o nominato l'utente: unire progetti suoi lo decide lui. Lascialo com'è; se pensi che siano lo stesso, glielo dirai quando parlate.`
                )
              }
            }
          }

          const record = await context.registry.mergeProjects(keepId, others, actor)
          return {
            content: `Uniti in «${record.title}».`,
            summary: `Progetti uniti in ${record.title}`
          }
        }
        case 'nascondi':
        case 'mostra': {
          const id = await projectOf(context, args)
          const record = await context.registry.setProjectHidden(
            id,
            action === 'nascondi',
            actor,
            seenOf(context, id)
          )
          saw(context, record)
          return {
            content: `${record.title} ${action === 'nascondi' ? 'nascosto' : 'di nuovo visibile'}.`,
            summary: `${action === 'nascondi' ? 'Nascosto' : 'Mostrato'}: ${record.title}`
          }
        }
        case 'concludi':
        case 'riapri': {
          const id = await projectOf(context, args)
          const record = await context.registry.setProjectClosed(
            id,
            action === 'concludi',
            actor,
            seenOf(context, id)
          )
          saw(context, record)
          return {
            content: `${record.title} ${action === 'concludi' ? 'concluso' : 'riaperto'}.`,
            summary: `${action === 'concludi' ? 'Concluso' : 'Riaperto'}: ${record.title}`
          }
        }
        case 'risorsa': {
          const projectId = await projectOf(context, args)
          const given = requireString(args, 'cartella')
          const link = /^https?:\/\//i.test(given)

          if (!isAbsolute(given) && !link) {
            throw new ToolInputError(
              '`cartella` è un percorso completo (o l’indirizzo di una risorsa in rete).'
            )
          }

          // Kept as the app keeps paths: the same folder reached through another mount point is one.
          const folder = link ? given : await canonicalPath(given)

          if (booleanArg(args, 'togli')) {
            await context.registry.removeProjectResource(projectId, folder, actor)
            return { content: `Tolta ${folder}.`, summary: `Tolta una risorsa dal progetto` }
          }

          await context.registry.addProjectResource(
            projectId,
            {
              kind: link ? 'link' : 'cartella',
              location: folder,
              label: stringArg(args, 'etichetta') ?? null
            },
            actor
          )
          return { content: `Collegata ${folder}.`, summary: `Collegata una cartella al progetto` }
        }
        default:
          throw new ToolInputError(`\`azione\` è una di: ${ACTIONS.join(', ')}.`)
      }
    } catch (error) {
      if (error instanceof RevisionConflict) {
        saw(context, error.current as ProjectRecord)
        throw new ToolConflict(error.message)
      }

      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
