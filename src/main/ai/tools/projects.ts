import { isAbsolute } from 'node:path'

import { searchMail, searchScope } from '../mail-search'
import { PROMPTS } from '../prompts'
import { RegistryRefusal, type ThreadRef } from '../registry/types'
import {
  booleanArg,
  requireString,
  stringArg,
  stringListArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { resolveMessage } from './anchors'
import { projectLine } from './describe'
import { countOf } from './format'

const ACTIONS = [
  'elenco',
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

function projectOf(context: ToolContext, args: Record<string, unknown>, name = 'progetto'): string {
  const handle = requireString(args, name)
  const project = context.handles.project(handle)

  if (!project) {
    throw new ToolInputError(
      `Non conosco il progetto «${handle}»: usa un riferimento p… da \`progetti\` o \`leggi\`.`
    )
  }

  return project.projectId
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

    for (const hit of hits) {
      threads.set(`${hit.ref.accountId}\u0000${hit.threadId}`, {
        accountId: hit.ref.accountId,
        threadId: hit.threadId
      })
    }
  }

  return [...threads.values()]
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
  running: (args) => (args.azione === 'elenco' ? 'Guardo i progetti…' : 'Aggiorno i progetti…'),
  async execute(args, context) {
    const action = requireString(args, 'azione') as (typeof ACTIONS)[number]
    const actor = context.run.actor

    try {
      switch (action) {
        case 'elenco': {
          const query = stringArg(args, 'cerca')
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

          return {
            content: `${created ? 'Creato' : 'Esisteva già'} ${handle} ${record.title}${linked > 0 ? `, con ${countOf(linked, 'conversazione', 'conversazioni')}` : ''}.`,
            summary: `${created ? 'Nuovo progetto' : 'Progetto'}: ${record.title}`
          }
        }
        case 'collega':
        case 'scollega': {
          const projectId = projectOf(context, args)
          const threads = await threadsOf(context, args)

          if (threads.length === 0) {
            throw new ToolInputError(
              'Indica le conversazioni: `mail` (riferimenti m…) o `ricerca`.'
            )
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
          return {
            content: `${action === 'collega' ? 'Messe' : 'Tolte'}: ${countOf(done, 'conversazione', 'conversazioni')}${
              refused.length > 0 ? `. Non fatte: ${[...new Set(refused)].join(' ')}` : '.'
            }`,
            summary: `${action === 'collega' ? 'In' : 'Tolte da'} ${project?.title ?? 'un progetto'}: ${countOf(done, 'conversazione', 'conversazioni')}`
          }
        }
        case 'rinomina': {
          const record = await context.registry.renameProject(
            projectOf(context, args),
            requireString(args, 'titolo'),
            actor
          )
          return {
            content: `Ora si chiama «${record.title}».`,
            summary: `Progetto rinominato: ${record.title}`
          }
        }
        case 'descrivi': {
          const record = await context.registry.describeProject(
            projectOf(context, args),
            requireString(args, 'descrizione'),
            actor
          )
          return {
            content: `Descrizione di ${record.title} aggiornata.`,
            summary: `Di cosa si tratta: ${record.title}`
          }
        }
        case 'punto': {
          const record = await context.registry.setProjectState(
            projectOf(context, args),
            requireString(args, 'testo'),
            actor
          )
          return {
            content: `Il punto di ${record.title} aggiornato.`,
            summary: `Il punto: ${record.title}`
          }
        }
        case 'unisci': {
          const keepId = projectOf(context, args)
          const others = stringListArg(args, 'con').map((handle) => {
            const project = context.handles.project(handle)

            if (!project) {
              throw new ToolInputError(`Non conosco il progetto «${handle}».`)
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
          const record = await context.registry.setProjectHidden(
            projectOf(context, args),
            action === 'nascondi',
            actor
          )
          return {
            content: `${record.title} ${action === 'nascondi' ? 'nascosto' : 'di nuovo visibile'}.`,
            summary: `${action === 'nascondi' ? 'Nascosto' : 'Mostrato'}: ${record.title}`
          }
        }
        case 'concludi':
        case 'riapri': {
          const record = await context.registry.setProjectClosed(
            projectOf(context, args),
            action === 'concludi',
            actor
          )
          return {
            content: `${record.title} ${action === 'concludi' ? 'concluso' : 'riaperto'}.`,
            summary: `${action === 'concludi' ? 'Concluso' : 'Riaperto'}: ${record.title}`
          }
        }
        case 'risorsa': {
          const projectId = projectOf(context, args)
          const folder = requireString(args, 'cartella')

          if (!isAbsolute(folder) && !/^https?:\/\//i.test(folder)) {
            throw new ToolInputError(
              '`cartella` è un percorso completo (o l’indirizzo di una risorsa in rete).'
            )
          }

          if (booleanArg(args, 'togli')) {
            await context.registry.removeProjectResource(projectId, folder, actor)
            return { content: `Tolta ${folder}.`, summary: `Tolta una risorsa dal progetto` }
          }

          await context.registry.addProjectResource(
            projectId,
            {
              kind: /^https?:/i.test(folder) ? 'link' : 'cartella',
              location: folder,
              label: stringArg(args, 'etichetta') ?? null
            },
            actor
          )
          return { content: `Collegata ${folder}.`, summary: `Collegata una cartella al progetto` }
        }
        default:
          throw new ToolInputError(`Azione sconosciuta «${action}».`)
      }
    } catch (error) {
      if (error instanceof RegistryRefusal) {
        throw new ToolInputError(error.message)
      }

      throw error
    }
  }
}
