import type { MessageRef } from '@shared/models'
import type { Commitment, CommitmentKind, Topic } from '@shared/segretario'
import { foldSearchText } from '@shared/search'

import {
  numberArg,
  stringArg,
  ToolInputError,
  type SegretarioTool,
  type ToolContext
} from '../agent/tool-types'
import { PROMPTS } from '../prompts'
import { countOf, formatDateTime, shortDate } from './format'

/** How many topics a list gives; past these, a search narrows them. */
const TOPICS_LISTED = 40
/** How many open things a list gives, the most pressing first. */
const COMMITMENTS_LISTED = 60

const KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  ti_chiedono: 'Ti chiedono',
  hai_promesso: 'Hai promesso',
  aspetti: 'Aspetti',
  da_fare: 'Da fare'
}

const KINDS = Object.keys(KIND_LABELS) as CommitmentKind[]

function topicHandle(topic: Pick<Topic, 'id' | 'title'>, context: ToolContext): string {
  return context.handles.name(
    { kind: 'topic', topicId: topic.id, title: topic.title },
    context.newHandles
  )
}

function topicLine(topic: Topic, context: ToolContext): string {
  return [
    `${topicHandle(topic, context)} · ${topic.title}${topic.archived ? ' (chiuso)' : ''}`,
    topic.gist ? `   ${topic.gist}` : null,
    `   ${countOf(topic.conversations, 'conversazione', 'conversazioni')} · ${countOf(topic.openCommitments, 'cosa aperta', 'cose aperte')}${
      topic.lastActivityAt
        ? ` · ultimo messaggio ${shortDate(new Date(topic.lastActivityAt).toISOString().slice(0, 10))}`
        : ''
    }`
  ]
    .filter(Boolean)
    .join('\n')
}

/** A topic named by its short name — or, failing that, by its title or number. */
async function resolveTopic(value: string, context: ToolContext): Promise<Topic> {
  const topics = await context.work.listTopics()
  const byHandle = context.handles.topic(value)

  if (byHandle) {
    const topic = topics.find((candidate) => candidate.id === byHandle.topicId)

    if (topic) {
      return topic
    }
  }

  const folded = foldSearchText(value.trim())
  const matches = topics.filter((topic) => foldSearchText(topic.title).includes(folded))

  if (matches.length === 1) {
    return matches[0]
  }

  throw new ToolInputError(
    matches.length > 1
      ? `«${value}» corrisponde a ${matches.length}: ${matches
          .slice(0, 8)
          .map((topic) => `${topicHandle(topic, context)} ${topic.title}`)
          .join('; ')}. Usa il riferimento.`
      : `Nessun argomento «${value}». Cercalo con azione "elenco" e "cerca".`
  )
}

export const topicsTool: SegretarioTool = {
  name: 'argomenti',
  description: PROMPTS.tools.argomenti,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: ['elenco', 'leggi', 'sposta'] },
      cerca: { type: 'string' },
      argomento: { type: 'string' },
      mail: { type: 'string' }
    },
    required: ['azione']
  },
  running: (args) => {
    switch (stringArg(args, 'azione')) {
      case 'leggi':
        return 'Guardo a che punto è…'
      case 'sposta':
        return 'Sposto la conversazione…'
      default:
        return stringArg(args, 'cerca')
          ? `Cerco «${stringArg(args, 'cerca')}» tra le questioni in corso…`
          : 'Guardo le questioni in corso…'
    }
  },
  async execute(args, context) {
    const label = context.work.topicsLabel()
    const action = stringArg(args, 'azione')

    if (action === 'leggi') {
      const wanted = stringArg(args, 'argomento')

      if (!wanted) {
        throw new ToolInputError('Dimmi quale: `argomento`.')
      }

      const summary = await resolveTopic(wanted, context)
      const topic = await context.work.getTopic(summary.id)

      if (!topic) {
        throw new ToolInputError(`${wanted} non c'è più.`)
      }

      const open = topic.commitments.filter((commitment) => commitment.status === 'aperto')
      const refs: MessageRef[] = []
      const conversations = topic.messages.slice(0, 30).map((item) => {
        refs.push(item.ref)
        const handle = context.handles.name(
          { kind: 'message', ref: item.ref, messageKey: item.messageKey },
          context.newHandles
        )
        return `- ${handle} · ${formatDateTime(item.date)} · ${item.from} · «${item.subject}»: ${item.text}`
      })

      return {
        content: [
          `# ${topicHandle(topic, context)} · ${topic.title}`,
          topic.gist,
          topic.folderPath ? `Cartella: ${topic.folderPath}` : null,
          topic.state
            ? `## A che punto è (scritto ${formatDateTime(new Date(topic.stateAt ?? 0).toISOString())})\n${topic.state}`
            : null,
          `## Cose aperte\n${
            open
              .map(
                (commitment) =>
                  `- #${commitment.id} ${KIND_LABELS[commitment.kind]}: ${commitment.text}${commitment.due ? ` (entro ${shortDate(commitment.due)})` : ''}`
              )
              .join('\n') || 'Nessuna.'
          }`,
          `## Conversazioni, dalla più recente (ognuna con il suo ultimo messaggio)\n${conversations.join('\n') || 'Nessuna.'}`
        ]
          .filter(Boolean)
          .join('\n\n'),
        summary: `${topic.title} · ${countOf(topic.conversations, 'conversazione', 'conversazioni')}`,
        messages: refs
      }
    }

    if (action === 'sposta') {
      const mailHandle = stringArg(args, 'mail')
      const message = mailHandle ? context.handles.message(mailHandle) : null

      if (!message) {
        throw new ToolInputError(
          'Dimmi il messaggio della conversazione: `mail`, un riferimento m….'
        )
      }

      const wanted = stringArg(args, 'argomento')

      if (!wanted) {
        throw new ToolInputError('Dimmi dove: `argomento`, o "nessuno".')
      }

      const topic =
        wanted.trim().toLowerCase() === 'nessuno' ? null : await resolveTopic(wanted, context)
      const { threadId } = await context.mail.readMessage(message.ref)
      await context.work.fileConversation(message.ref.accountId, threadId, topic?.id ?? null)

      return {
        content: topic
          ? `Fatto: la conversazione è in ${topicHandle(topic, context)} ${topic.title}.`
          : 'Fatto: la conversazione non è più in nessun argomento.',
        summary: topic ? `Spostata in ${topic.title}` : `Tolta da ${label.toLowerCase()}`,
        messages: [message.ref]
      }
    }

    const query = stringArg(args, 'cerca')?.trim()
    const topics = await context.work.listTopics()
    const folded = query ? foldSearchText(query) : ''
    const chosen = query
      ? topics.filter((topic) =>
          foldSearchText(`${topic.title} ${topic.gist ?? ''} ${topic.description ?? ''}`).includes(
            folded
          )
        )
      : topics.filter((topic) => !topic.archived && topic.conversations > 0)

    if (chosen.length === 0) {
      return {
        content: query
          ? `Nessun argomento con «${query}».`
          : 'Nessuna questione in corso con conversazioni.',
        summary: query ? `Cercato «${query}» · nessuno` : 'Nessuna in corso'
      }
    }

    const listed = chosen.slice(0, TOPICS_LISTED)

    return {
      content: `${countOf(chosen.length, 'argomento', 'argomenti')}${
        chosen.length > listed.length ? `, i primi ${listed.length}: restringi con «cerca»` : ''
      }:\n\n${listed.map((topic) => topicLine(topic, context)).join('\n\n')}`,
      summary: query
        ? `Cercato «${query}» · ${countOf(chosen.length, 'risultato', 'risultati')}`
        : `${label} in corso · ${chosen.length}`
    }
  }
}

/** The pressing first: overdue and due soonest, then those without a date, the newest first. */
function byUrgency(a: Commitment, b: Commitment): number {
  if (a.due && b.due) {
    return a.due.localeCompare(b.due)
  }

  if (a.due || b.due) {
    return a.due ? -1 : 1
  }

  return b.createdAt - a.createdAt
}

export const commitmentsTool: SegretarioTool = {
  name: 'impegni',
  description: PROMPTS.tools.impegni,
  parameters: {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: ['elenco', 'chiudi'] },
      tipo: { type: 'string', enum: KINDS },
      entro: { type: 'string' },
      argomento: { type: 'string' },
      id: { type: 'integer' }
    },
    required: ['azione']
  },
  running: (args) =>
    stringArg(args, 'azione') === 'chiudi' ? 'Segno come fatto…' : 'Guardo le cose aperte…',
  async execute(args, context) {
    if (stringArg(args, 'azione') === 'chiudi') {
      const id = numberArg(args, 'id')

      if (id === undefined || !(await context.work.closeCommitment(id))) {
        throw new ToolInputError(`Nessuna cosa aperta #${id ?? '?'}: guardale con azione "elenco".`)
      }

      return { content: `Fatto: #${id} è chiusa.`, summary: `Chiusa #${id}` }
    }

    const kind = stringArg(args, 'tipo') as CommitmentKind | undefined
    const until = stringArg(args, 'entro')?.trim()

    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      throw new ToolInputError('`entro` è una data AAAA-MM-GG.')
    }

    const wantedTopic = stringArg(args, 'argomento')
    const topic = wantedTopic ? await resolveTopic(wantedTopic, context) : null
    let open = (await context.work.openCommitments())
      .filter((commitment) => !kind || commitment.kind === kind)
      .filter((commitment) => !until || (commitment.due !== null && commitment.due <= until))
    const topicIds = await context.work.conversationTopics(
      open.map((commitment) => ({ accountId: commitment.accountId, threadId: commitment.threadId }))
    )
    const topicOf = new Map(open.map((commitment, index) => [commitment.id, topicIds[index]]))

    if (topic) {
      open = open.filter((commitment) => topicOf.get(commitment.id) === topic.id)
    }

    if (open.length === 0) {
      return { content: 'Nessuna cosa aperta con questi criteri.', summary: 'Nessuna cosa aperta' }
    }

    const listed = [...open].sort(byUrgency).slice(0, COMMITMENTS_LISTED)
    const topics = new Map((await context.work.listTopics()).map((item) => [item.id, item]))
    const summaries = new Map<string, Awaited<ReturnType<typeof context.mail.messageSummaries>>>()

    for (const accountId of new Set(listed.map((commitment) => commitment.accountId))) {
      summaries.set(
        accountId,
        await context.mail.messageSummaries(
          accountId,
          listed
            .filter((commitment) => commitment.accountId === accountId)
            .map((commitment) => commitment.messageKey)
        )
      )
    }

    const refs: MessageRef[] = []
    const lines = listed.map((commitment) => {
      const message = summaries.get(commitment.accountId)?.get(commitment.messageKey)
      const inTopic = topics.get(topicOf.get(commitment.id) ?? '')
      let source: string | null = null

      if (message) {
        refs.push(message.ref)
        const handle = context.handles.name(
          { kind: 'message', ref: message.ref, messageKey: commitment.messageKey },
          context.newHandles
        )
        source = `${handle} «${message.subject}» da ${message.from[0]?.name || message.from[0]?.address || ''}`
      }

      return [
        `#${commitment.id} · ${KIND_LABELS[commitment.kind]}: ${commitment.text}${commitment.due ? ` · entro ${shortDate(commitment.due)}` : ''}`,
        `   ${[source, inTopic ? `${topicHandle(inTopic, context)} ${inTopic.title}` : null].filter(Boolean).join(' · ')}`
      ].join('\n')
    })

    return {
      content: `${countOf(open.length, 'cosa aperta', 'cose aperte')}${
        open.length > listed.length ? `, le ${listed.length} più urgenti` : ''
      }, le più urgenti per prime:\n\n${lines.join('\n')}`,
      summary: countOf(open.length, 'cosa aperta', 'cose aperte'),
      messages: refs
    }
  }
}
