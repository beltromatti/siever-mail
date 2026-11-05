import { useCallback, useEffect, useState } from 'react'
import { Briefcase, CalendarPlus, ChevronDown, FolderArchive, PenLine } from 'lucide-react'
import { toast } from 'sonner'

import extensionRenderer from '@app/extension/renderer'
import { Button } from '@renderer/components/ui/button'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { cn } from '@renderer/lib/utils'
import type { Commitment, MessageWork, Project, Proposal } from '@shared/segretario'
import type { MessageRef } from '@shared/models'

import { CommitmentList } from './commitment-row'
import { ProjectPickerPopover } from './project-picker'
import { eventProposalWords } from './proposal-words'
import { COMMITMENT_LABELS, dueLabel } from './row-work'

const PRIORITY_LABELS = { alta: 'Importante', media: null, bassa: 'Può aspettare' } as const
const SHORT_DAY = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const WHEN = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** "…/Prat2451-CASEIFICIO VALLI/CORRISPONDENZA/261027Celle" as it reads: the last few places. */
function savedPlace(destination: string): string {
  const parts = destination.split(/[\\/]/).filter(Boolean)
  const start = parts.findIndex((part) => /^prat/i.test(part))
  return parts.slice(start >= 0 ? start : Math.max(0, parts.length - 3)).join(' › ')
}

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
  const [picking, setPicking] = useState(false)

  const set = async (projectId: string, link: boolean): Promise<void> => {
    try {
      await window.segretarioApi.setConversationProject({ accountId, threadId }, projectId, link)
    } catch (error) {
      toast.error(link ? 'Non è entrata nel progetto' : 'Non è uscita dal progetto', {
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
              title={`Apri ${project.title}`}
              className="text-foreground focus-visible:ring-ring/60 min-w-0 truncate rounded-sm font-semibold outline-none hover:underline focus-visible:ring-2"
            >
              {project.title}
            </button>
            {index < linked.length - 1 && <span className="text-faint-foreground">,</span>}
          </span>
        ))
      ) : (
        <span className="text-muted-foreground">In nessun progetto</span>
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
              toast.error('Il progetto non è stato creato', {
                description: error instanceof Error ? error.message : undefined
              })
            )
        }}
        trigger={
          <button
            type="button"
            aria-label={linked.length > 0 ? 'Cambia i progetti' : 'Metti in un progetto'}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex shrink-0 items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2"
          >
            {linked.length > 0 ? 'Cambia' : 'Scegli'}
            <ChevronDown className="size-3" />
          </button>
        }
      />
    </div>
  )
}

/** A copy of the message saved outside the mail, with the folder a click away. */
function CopyLine({ copy }: { copy: MessageWork['copies'][number] }): React.JSX.Element {
  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-[11.5px]">
      <FolderArchive className="text-faint-foreground size-3.5 shrink-0" />
      <span className="min-w-0 truncate" title={copy.destination}>
        <span className="text-foreground font-semibold">{copy.label}</span> in{' '}
        {savedPlace(copy.destination)} · {SHORT_DAY.format(new Date(copy.savedAt))}
      </span>
      <button
        type="button"
        onClick={() => void window.mailApi.revealFile(copy.destination)}
        className="hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm outline-none focus-visible:ring-2"
      >
        Mostra
      </button>
    </div>
  )
}

/** When a proposed event is, as a line: "gio 6 nov, 10:00" or the day for one all day. */
function eventWhen(payload: Record<string, unknown>): string {
  const start = String(payload.start ?? '')

  if (payload.allDay) {
    return `${SHORT_DAY.format(new Date(`${start.slice(0, 10)}T00:00`))}, tutto il giorno`
  }

  const date = new Date(start)
  return Number.isNaN(date.getTime()) ? start : WHEN.format(date)
}

/**
 * Something the Segretario recommends: the user accepts it, as it is, or
 * sets it aside. An event is put in the calendar from here; what an
 * extension proposes (ARCHIVIA SIEVER) opens its own dialog, filled in.
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
        toast.error(accepted ? 'Non è stato fatto' : 'Non è stata tolta', {
          description: error instanceof Error ? error.message : undefined
        })
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="bg-ai-soft/45 flex flex-col gap-1.5 rounded-[8px] px-3 py-2.5">
      <p className="text-ai text-[11.5px] font-semibold">{words?.heading ?? 'Proposta'}</p>
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
          {proposal.source.subject && ` · «${proposal.source.subject}»`}
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
              ? ` · invita ${attendees.join(', ')}`
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
            {action.label}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => decide(false)}>
          Ignora
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
      {work.copies.map((copy) => (
        <CopyLine key={copy.destination} copy={copy} />
      ))}
    </div>
  )

  // Noise, or a message it has nothing on: where it is filed is all there is to say.
  if (!hasWork && (!note || note.nature === 'rumore')) {
    return <div className="mb-3">{facts}</div>
  }

  const priority = note ? PRIORITY_LABELS[note.priority] : null
  const reply = work.reply

  return (
    <section
      aria-label="Il punto del Segretario"
      className="border-ai-line mb-4 flex flex-col gap-2 border-l-2 py-0.5 pl-3.5"
    >
      {facts}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <CompassStar className="text-ai-star size-3.5" />
        <span className="text-ai font-semibold">Il punto</span>
        {(owed || awaited) && (
          <span
            className={cn(
              'font-semibold',
              note?.priority === 'alta' ? 'text-urgent' : 'text-foreground'
            )}
          >
            {owed ? COMMITMENT_LABELS[owed.kind] : 'In attesa'}
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
                  toast.error('Non segnata come gestita', {
                    description: error instanceof Error ? error.message : undefined
                  })
                )
            }
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
          >
            Segna come gestito
          </button>
        )}
      </div>
      {note && <p className="voice text-foreground text-[15px] leading-[1.45]">{note.summary}</p>}
      {note?.twinAccountId && (
        <p className="text-muted-foreground text-[11.5px]">
          Arrivata anche a {accountEmail(note.twinAccountId) ?? 'un altro tuo account'}: la nota è
          la stessa, le cose aperte sono seguite lì.
        </p>
      )}
      {reply && (
        <div className="bg-ai-soft/45 flex flex-col gap-2 rounded-[8px] px-3 py-2.5">
          <p className="text-ai text-[11.5px] font-semibold">
            {reply.kind === 'sollecito' ? 'Sollecito pronto' : 'Risposta pronta'}
            {reply.status === 'da_rivedere' && (
              <span className="text-urgent">
                {' '}
                · da rivedere{reply.staleReason ? `: ${reply.staleReason}` : ''}
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
              {reply.kind === 'sollecito' ? 'Usa questo sollecito' : 'Usa questa risposta'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={takingUp}
              onClick={() =>
                void window.segretarioApi.discardReply(reply.accountId, reply.messageKey)
              }
            >
              Scarta
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
