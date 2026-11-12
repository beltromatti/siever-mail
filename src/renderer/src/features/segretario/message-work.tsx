import { useCallback, useEffect, useState } from 'react'
import { Briefcase, CalendarPlus, ChevronDown, PenLine } from 'lucide-react'
import { toast } from 'sonner'

import extensionRenderer from '@app/extension/renderer'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { hourStyle, languageNow, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, localized } from '@shared/i18n'
import { PLACES } from '@shared/places'
import type { Commitment, MessageWork, Project, Proposal } from '@shared/segretario'
import type { MessageRef } from '@shared/models'

import { CommitmentList } from './commitment-row'
import { ProjectPickerPopover } from './project-picker'
import { eventProposalWords } from './proposal-words'
import { COMMITMENT_LABELS, dueLabel } from './row-work'

const MESSAGES = defineMessages({
  important: { en: 'Important', it: 'Importante', de: 'Wichtig' },
  canWait: { en: 'Can wait', it: 'Può aspettare', de: 'Kann warten' },
  notAdded: {
    en: 'Not added to the project',
    it: 'Non è entrata nel progetto',
    de: 'Nicht zum Projekt hinzugefügt'
  },
  notRemoved: {
    en: 'Not removed from the project',
    it: 'Non è uscita dal progetto',
    de: 'Nicht aus dem Projekt entfernt'
  },
  open: {
    en: (name: string) => `Open ${name}`,
    it: (name: string) => `Apri ${name}`,
    de: (name: string) => `${name} öffnen`
  },
  noProject: { en: 'In no project', it: 'In nessun progetto', de: 'In keinem Projekt' },
  notCreated: {
    en: 'The project wasn’t created',
    it: 'Il progetto non è stato creato',
    de: 'Das Projekt wurde nicht erstellt'
  },
  changeProjects: { en: 'Change projects', it: 'Cambia i progetti', de: 'Projekte ändern' },
  putInProject: {
    en: 'Put in a project',
    it: 'Metti in un progetto',
    de: 'Einem Projekt zuordnen'
  },
  change: { en: 'Change', it: 'Cambia', de: 'Ändern' },
  choose: { en: 'Choose', it: 'Scegli', de: 'Auswählen' },
  allDay: {
    en: (day: string) => `${day}, all day`,
    it: (day: string) => `${day}, tutto il giorno`,
    de: (day: string) => `${day}, ganztägig`
  },
  notDone: { en: 'It wasn’t done', it: 'Non è stato fatto', de: 'Wurde nicht ausgeführt' },
  notSetAside: { en: 'It wasn’t removed', it: 'Non è stata tolta', de: 'Wurde nicht entfernt' },
  proposal: { en: 'Proposal', it: 'Proposta', de: 'Vorschlag' },
  quoted: {
    en: (text: string) => `“${text}”`,
    it: (text: string) => `«${text}»`,
    de: (text: string) => `„${text}“`
  },
  invites: {
    en: (who: string) => ` · invites ${who}`,
    it: (who: string) => ` · invita ${who}`,
    de: (who: string) => ` · lädt ${who} ein`
  },
  ignore: { en: 'Ignore', it: 'Ignora', de: 'Ignorieren' },
  sectionLabel: {
    en: 'Where it stands, from the Segretario',
    it: 'Il punto del Segretario',
    de: 'Stand der Dinge vom Segretario'
  },
  notHandled: {
    en: 'Not marked as handled',
    it: 'Non segnata come gestita',
    de: 'Nicht als bearbeitet markiert'
  },
  markHandled: {
    en: 'Mark as handled',
    it: 'Segna come gestito',
    de: 'Als bearbeitet markieren'
  },
  twin: {
    en: (account: string) =>
      `Also arrived at ${account}: the note is the same, and its open items are followed there.`,
    it: (account: string) =>
      `Arrivata anche a ${account}: la nota è la stessa, le cose aperte sono seguite lì.`,
    de: (account: string) =>
      `Auch an ${account} eingegangen: Die Notiz ist dieselbe, die offenen Punkte werden dort verfolgt.`
  },
  anotherAccount: {
    en: 'another of your accounts',
    it: 'un altro tuo account',
    de: 'ein anderes Ihrer Konten'
  },
  followUpReady: { en: 'Follow-up ready', it: 'Sollecito pronto', de: 'Nachfassen vorbereitet' },
  replyReady: { en: 'Ready reply', it: 'Risposta pronta', de: 'Fertige Antwort' },
  toReview: { en: 'to review', it: 'da rivedere', de: 'zu überprüfen' },
  useFollowUp: {
    en: 'Use this follow-up',
    it: 'Usa questo sollecito',
    de: 'Dieses Nachfassen verwenden'
  },
  useReply: { en: 'Use this reply', it: 'Usa questa risposta', de: 'Diese Antwort verwenden' },
  discard: { en: 'Discard', it: 'Scarta', de: 'Verwerfen' }
})

const SHORT_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
/** Made when used: the hour is written as the region writes it now. */
const WHEN = (): Intl.DateTimeFormatOptions => ({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: hourStyle(),
  minute: '2-digit'
})

/** The projects the conversation is in, each opening its list, and the picker that moves it. */
function ProjectsLine({
  accountId,
  threadId,
  linked,
  projects,
  onOpenProject
}: {
  accountId: string
  threadId: string
  linked: MessageWork['projects']
  projects: ReadonlyArray<Project>
  onOpenProject: (projectId: string) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [picking, setPicking] = useState(false)

  const set = async (projectId: string, link: boolean): Promise<void> => {
    try {
      await window.segretarioApi.setConversationProject({ accountId, threadId }, projectId, link)
    } catch (error) {
      toast.error(link ? messagesNow(MESSAGES).notAdded : messagesNow(MESSAGES).notRemoved, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px]">
      <Briefcase className="text-faint-foreground size-3.5 shrink-0" />
      {linked.length > 0 ? (
        linked.map((project, index) => (
          <span key={project.id} className="flex min-w-0 items-center">
            <button
              type="button"
              onClick={() => onOpenProject(project.id)}
              title={m.open(project.title)}
              className="text-foreground focus-visible:ring-ring/60 min-w-0 truncate rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
            >
              {project.title}
            </button>
            {index < linked.length - 1 && <span className="text-faint-foreground">,</span>}
          </span>
        ))
      ) : (
        <span className="text-muted-foreground">{m.noProject}</span>
      )}
      <ProjectPickerPopover
        open={picking}
        onOpenChange={setPicking}
        projects={projects}
        linkedIds={linked.map((project) => project.id)}
        onToggle={(project, link) => {
          setPicking(false)
          void set(project.id, link)
        }}
        onCreate={(title) => {
          setPicking(false)
          void window.segretarioApi
            .createProject(title)
            .then((created) => set(created.id, true))
            .catch((error: unknown) =>
              toast.error(messagesNow(MESSAGES).notCreated, {
                description: error instanceof Error ? error.message : undefined
              })
            )
        }}
        trigger={
          <button
            type="button"
            aria-label={linked.length > 0 ? m.changeProjects : m.putInProject}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex shrink-0 items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2"
          >
            {linked.length > 0 ? m.change : m.choose}
            <ChevronDown className="size-3" />
          </button>
        }
      />
    </div>
  )
}

/** When a proposed event is, as a line: "Thu, Nov 6, 10:00" or the day for one all day. */
function eventWhen(payload: Record<string, unknown>): string {
  const start = String(payload.start ?? '')
  const { formatLocale } = languageNow()

  if (payload.allDay) {
    return messagesNow(MESSAGES).allDay(
      new Intl.DateTimeFormat(formatLocale, SHORT_DAY).format(
        new Date(`${start.slice(0, 10)}T00:00`)
      )
    )
  }

  const date = new Date(start)
  return Number.isNaN(date.getTime())
    ? start
    : new Intl.DateTimeFormat(formatLocale, WHEN()).format(date)
}

/**
 * Something the Segretario recommends: the user accepts it, as it is, or
 * sets it aside. An event is put in the calendar from here; what an
 * extension proposes opens its own dialog, filled in.
 */
export function ProposalCard({
  proposal,
  onAct,
  onOpenSource
}: {
  proposal: Proposal
  /** Carries out what an extension proposes: its command, on the proposal's message. */
  onAct?: (proposal: Proposal) => void
  /** Away from its message (Oggi), the card says which one it is, and opens it. */
  onOpenSource?: (ref: MessageRef) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { language } = useLanguage()
  const [busy, setBusy] = useState(false)
  const event = proposal.kind === 'evento'
  const words = event ? eventProposalWords(proposal) : null
  const action = event ? undefined : extensionRenderer.proposalActions?.[proposal.kind]
  const attendees = Array.isArray(proposal.payload.attendees)
    ? (proposal.payload.attendees as string[])
    : []

  const decide = (accepted: boolean): void => {
    setBusy(true)
    void window.segretarioApi
      .decideProposal(proposal.id, accepted, undefined, proposal.revision)
      .then(
        () =>
          accepted &&
          words &&
          toast(words.done, { description: String(proposal.payload.title ?? '') })
      )
      .catch((error: unknown) =>
        toast.error(accepted ? messagesNow(MESSAGES).notDone : messagesNow(MESSAGES).notSetAside, {
          description: error instanceof Error ? error.message : undefined
        })
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="bg-ai-soft/45 flex flex-col gap-1.5 rounded-[8px] px-3 py-2.5">
      <p className="text-ai text-[11.5px] font-semibold">{words?.heading ?? m.proposal}</p>
      <p className="text-foreground text-[13px] leading-[1.45]">
        {event ? String(proposal.payload.title ?? proposal.title) : proposal.title}
      </p>
      {proposal.source && onOpenSource && (
        <button
          type="button"
          onClick={() => proposal.source && onOpenSource(proposal.source.ref)}
          className="text-muted-foreground focus-visible:ring-ring/60 -mx-1 min-w-0 truncate rounded-sm px-1 text-left text-[12px] leading-[1.45] outline-none hover:underline focus-visible:ring-2"
        >
          {proposal.source.from}
          {proposal.source.subject && ` · ${m.quoted(proposal.source.subject)}`}
        </button>
      )}
      {words && words.changes.length > 0 ? (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-[12px] leading-[1.45]">
          {words.changes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        event && (
          <p className="text-muted-foreground text-[12px] leading-[1.45]">
            {eventWhen(proposal.payload)}
            {proposal.payload.location ? ` · ${String(proposal.payload.location)}` : ''}
            {attendees.length > 0 && !proposal.payload.eventKey
              ? m.invites(attendees.join(', '))
              : ''}
          </p>
        )
      )}
      <div className="flex items-center gap-1.5">
        {words && (
          <Button size="sm" disabled={busy} onClick={() => decide(true)}>
            <CalendarPlus className="size-3.5" />
            {words.action}
          </Button>
        )}
        {action && onAct && (
          <Button size="sm" variant="brand" disabled={busy} onClick={() => onAct(proposal)}>
            {localized(action.label, language)}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => decide(false)}>
          {m.ignore}
        </Button>
      </div>
    </div>
  )
}

/**
 * "Il punto": the Segretario's word on the message open in the reader —
 * what it said, what is open in its conversation, each thing to tick off,
 * the reply ready, what it proposes — written in its hand, in the margin.
 */
export function MessageWorkPanel({
  accountId,
  messageKey,
  threadId,
  projects,
  onOpenProject,
  accountEmail,
  onTakeUpReply,
  onRemind,
  onActOnProposal
}: {
  accountId: string
  messageKey: string
  threadId: string
  /** Every project, for the picker. */
  projects: ReadonlyArray<Project>
  onOpenProject: (projectId: string) => void
  /** The address of one of the user's accounts, by id. */
  accountEmail: (accountId: string) => string | undefined
  /** Opens the reply prepared ahead in the composer, as the user's own. */
  onTakeUpReply: (accountId: string, messageKey: string, text: string) => Promise<void>
  /** Asks the Segretario for a reminder to who is awaited. */
  onRemind: (commitment: Commitment) => void
  /** Carries out what an extension proposes on this message. */
  onActOnProposal: (proposal: Proposal) => void
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const kinds = useMessages(COMMITMENT_LABELS)
  const [work, setWork] = useState<MessageWork | null>(null)
  const [takingUp, setTakingUp] = useState(false)

  const load = useCallback(
    async (): Promise<void> =>
      setWork(await window.segretarioApi.getMessageWork(accountId, messageKey)),
    [accountId, messageKey]
  )

  useEffect(() => {
    let current = true

    void window.segretarioApi
      .getMessageWork(accountId, messageKey)
      .then((loaded) => current && setWork(loaded))

    const unsubscribe = window.segretarioApi.onWorkChanged((change) => {
      if (
        (change.accountIds.length === 0 || change.accountIds.includes(accountId)) &&
        (change.threadIds.includes(threadId) ||
          change.messageKeys.includes(messageKey) ||
          change.projectIds.length > 0)
      ) {
        void load()
      }
    })

    return () => {
      current = false
      unsubscribe()
    }
  }, [accountId, messageKey, threadId, load])

  if (!work) {
    return null
  }

  const note = work.note
  const open = work.commitments.filter((commitment) => commitment.status === 'aperta')
  const owed = open.find((commitment) => commitment.kind !== 'aspetti')
  const awaited = open.some((commitment) => commitment.kind === 'aspetti')
  const hasWork = work.commitments.length > 0 || work.reply !== null || work.proposals.length > 0
  const facts = (
    <div className="flex flex-col gap-1">
      <ProjectsLine
        accountId={accountId}
        threadId={threadId}
        linked={work.projects}
        projects={projects}
        onOpenProject={onOpenProject}
      />
    </div>
  )

  // Noise, or a message it has nothing on: where it is filed is all there is to say.
  if (!hasWork && (!note || note.nature === 'rumore')) {
    return <div className="mb-3">{facts}</div>
  }

  const priority =
    note?.priority === 'alta' ? m.important : note?.priority === 'bassa' ? m.canWait : null
  const reply = work.reply

  return (
    <section
      aria-label={m.sectionLabel}
      className="border-ai-line mb-4 flex flex-col gap-2 border-l-2 py-0.5 pl-3.5"
    >
      {facts}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <CompassStar className="text-ai-star size-3.5" />
        <span className="text-ai font-semibold">{places.whereItStands}</span>
        {(owed || awaited) && (
          <span
            className={cn(
              'font-semibold',
              note?.priority === 'alta' ? 'text-urgent' : 'text-foreground'
            )}
          >
            {owed ? kinds[owed.kind] : places.waiting}
            {owed?.due && ` · ${dueLabel(owed.due)}`}
          </span>
        )}
        {priority && <span className="text-muted-foreground">{priority}</span>}
        <div className="flex-1" />
        {owed && (
          <button
            type="button"
            onClick={() =>
              void window.segretarioApi
                .markHandled([{ accountId, messageKey }])
                .catch((error: unknown) =>
                  toast.error(messagesNow(MESSAGES).notHandled, {
                    description: error instanceof Error ? error.message : undefined
                  })
                )
            }
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
          >
            {m.markHandled}
          </button>
        )}
      </div>
      {note && <p className="voice text-foreground text-[15px] leading-[1.45]">{note.summary}</p>}
      {note?.twinAccountId && (
        <p className="text-muted-foreground text-[11.5px]">
          {m.twin(accountEmail(note.twinAccountId) ?? m.anotherAccount)}
        </p>
      )}
      {reply && (
        <div className="bg-ai-soft/45 flex flex-col gap-2 rounded-[8px] px-3 py-2.5">
          <p className="text-ai text-[11.5px] font-semibold">
            {reply.kind === 'sollecito' ? m.followUpReady : m.replyReady}
            {reply.status === 'da_rivedere' && (
              <span className="text-urgent">
                {' '}
                · {m.toReview}
                {reply.staleReason ? `: ${reply.staleReason}` : ''}
              </span>
            )}
          </p>
          <p className="voice text-foreground max-h-56 overflow-y-auto text-[14px] leading-[1.5] whitespace-pre-wrap">
            {reply.text}
          </p>
          {reply.doubts && (
            <p className="text-muted-foreground text-[12px] leading-[1.45]">{reply.doubts}</p>
          )}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              disabled={takingUp}
              onClick={() => {
                setTakingUp(true)
                void onTakeUpReply(reply.accountId, reply.messageKey, reply.text).finally(() =>
                  setTakingUp(false)
                )
              }}
            >
              <PenLine className="size-3.5" />
              {reply.kind === 'sollecito' ? m.useFollowUp : m.useReply}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={takingUp}
              onClick={() =>
                void window.segretarioApi.discardReply(reply.accountId, reply.messageKey)
              }
            >
              {m.discard}
            </Button>
          </div>
        </div>
      )}
      {work.proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} onAct={onActOnProposal} />
      ))}
      <CommitmentList commitments={work.commitments} onRemind={onRemind} />
    </section>
  )
}
