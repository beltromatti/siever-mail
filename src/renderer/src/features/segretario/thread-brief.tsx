import { useCallback, useEffect, useState } from 'react'
import { Check, PenLine } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { Commitment, CommitmentKind, ThreadBrief } from '@shared/segretario'

import { dueLabel, NOTE_ACTION_LABELS, noteAsks } from './message-notes'

const COMMITMENT_LABELS: Readonly<Record<CommitmentKind, string>> = {
  ti_chiedono: 'Ti chiedono',
  hai_promesso: 'Hai promesso',
  aspetti: 'Aspetti',
  da_fare: 'Da fare'
}

const PRIORITY_LABELS = { alta: 'Importante', media: null, bassa: 'Può aspettare' } as const

/** What closed long ago is history: the ticked things kept are those of the last week. */
function withRecentCommitments(brief: ThreadBrief): ThreadBrief {
  const recent = Date.now() - 7 * 24 * 60 * 60 * 1000

  return {
    ...brief,
    commitments: brief.commitments.filter(
      (commitment) => commitment.status === 'aperto' || (commitment.closedAt ?? 0) > recent
    )
  }
}

function CommitmentRow({
  commitment,
  onClose
}: {
  commitment: Commitment
  onClose: () => void
}): React.JSX.Element {
  const closed = commitment.status === 'chiuso'

  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-[1.45]">
      <button
        type="button"
        disabled={closed}
        onClick={onClose}
        aria-label={closed ? 'Fatto' : `Segna come fatto: ${commitment.text}`}
        className={cn(
          'focus-visible:ring-ring/60 mt-[2px] grid size-[14px] shrink-0 place-items-center rounded-[4px] outline-none focus-visible:ring-2',
          closed
            ? 'bg-ai text-background'
            : 'hover:bg-ai-soft shadow-[inset_0_0_0_1px_hsl(var(--ai-line))]'
        )}
      >
        {closed && <Check className="size-2.5" strokeWidth={3} />}
      </button>
      <span className={cn('min-w-0', closed && 'text-faint-foreground line-through')}>
        <span className="text-muted-foreground">{COMMITMENT_LABELS[commitment.kind]}:</span>{' '}
        {commitment.text}
        {commitment.due && !closed && (
          <span className="text-muted-foreground"> · {dueLabel(commitment.due)}</span>
        )}
      </span>
    </li>
  )
}

/**
 * "Il punto": the Segretario's word on the conversation open in the
 * reader — where it leaves the user and what is open in it, each thing to
 * tick off — written in its hand, in the margin of the message.
 */
export function ThreadBriefPanel({
  accountId,
  threadId,
  onTakeUpReadyDraft
}: {
  accountId: string
  threadId: string
  /** Opens the reply prepared ahead in the composer, as the user's own. */
  onTakeUpReadyDraft: (accountId: string, messageKey: string, text: string) => Promise<void>
}): React.JSX.Element | null {
  const [brief, setBrief] = useState<ThreadBrief | null>(null)
  const [takingUp, setTakingUp] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setBrief(withRecentCommitments(await window.segretarioApi.getThreadBrief(accountId, threadId)))
  }, [accountId, threadId])

  useEffect(() => {
    let current = true

    void window.segretarioApi.getThreadBrief(accountId, threadId).then((loaded) => {
      if (current) {
        setBrief(withRecentCommitments(loaded))
      }
    })

    const unsubscribe = window.segretarioApi.onNotesChanged((change) => {
      if (change.accountId === accountId && change.threadIds.includes(threadId)) {
        void load()
      }
    })

    return () => {
      current = false
      unsubscribe()
    }
  }, [accountId, threadId, load])

  const note = brief?.note

  if (!brief || !note || note.state === 'rumore') {
    return null
  }

  const action = noteAsks(note) ? NOTE_ACTION_LABELS[note.state] : null
  const priority = PRIORITY_LABELS[note.priority]
  const commitments = brief.commitments

  return (
    <section
      aria-label="Il punto del Segretario"
      className="border-ai-line mb-4 flex flex-col gap-2 border-l-2 py-0.5 pl-3.5"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
        <PenLine className="text-ai size-3.5" />
        <span className="text-ai font-semibold">Il punto</span>
        {action && (
          <span
            className={cn(
              'font-semibold',
              note.priority === 'alta' ? 'text-seal-text' : 'text-foreground'
            )}
          >
            {action}
            {note.due && ` · ${dueLabel(note.due)}`}
          </span>
        )}
        {priority && <span className="text-muted-foreground">{priority}</span>}
        <div className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={() => void window.segretarioApi.dismissNote(note.accountId, note.messageKey)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm outline-none focus-visible:ring-2"
          >
            Segna come gestito
          </button>
        )}
      </div>
      <p className="voice text-foreground text-[15px] leading-[1.45]">{note.summary}</p>
      {brief.readyDraft && (
        <div className="bg-ai-soft/45 flex flex-col gap-2 rounded-[8px] px-3 py-2.5">
          <p className="text-ai text-[11.5px] font-semibold">Risposta pronta</p>
          <p className="voice text-foreground max-h-56 overflow-y-auto text-[14px] leading-[1.5] whitespace-pre-wrap">
            {brief.readyDraft.text}
          </p>
          {brief.readyDraft.doubts && (
            <p className="text-muted-foreground text-[12px] leading-[1.45]">
              {brief.readyDraft.doubts}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              disabled={takingUp}
              onClick={() => {
                const draft = brief.readyDraft

                if (!draft) {
                  return
                }

                setTakingUp(true)
                void onTakeUpReadyDraft(note.accountId, draft.messageKey, draft.text).finally(() =>
                  setTakingUp(false)
                )
              }}
            >
              <PenLine className="size-3.5" />
              Usa questa risposta
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={takingUp}
              onClick={() =>
                brief.readyDraft &&
                void window.segretarioApi.discardReadyDraft(
                  note.accountId,
                  brief.readyDraft.messageKey
                )
              }
            >
              Scarta
            </Button>
          </div>
        </div>
      )}
      {commitments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {commitments.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              onClose={() => void window.segretarioApi.closeCommitment(commitment.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
