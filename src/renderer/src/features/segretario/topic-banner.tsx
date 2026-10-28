import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, FolderOpen, LoaderCircle, MoreHorizontal, PenLine, RefreshCw } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { IconButton } from '@renderer/components/ui/icon-button'
import { usePromptDialog } from '@renderer/components/ui/prompt-dialog'
import { cn, formatCount } from '@renderer/lib/utils'
import type { TopicDetail } from '@shared/segretario'

import { CommitmentRow } from './thread-brief'

/** About what four lines of the state hold in the list's width: past it, it folds. */
const STATE_CLAMPED_CHARS = 220
/** Past these, the open things say how many more there are. */
const COMMITMENTS_SHOWN = 4

const WRITTEN_AT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/**
 * Above the list of a topic — a pratica — the Segretario's word on where it
 * stands and what is open in it. The word is written again by itself when
 * the topic moved since it was last written, or when asked.
 */
export function TopicBanner({
  topicId,
  canWrite,
  onChanged
}: {
  topicId: string
  /** The key answers: the state can be written. */
  canWrite: boolean
  /** The topic was renamed, archived or brought back: the sidebar follows. */
  onChanged: () => void
}): React.JSX.Element | null {
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [writing, setWriting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [stateOpen, setStateOpen] = useState(false)
  const reloadTimer = useRef<number | null>(null)
  const { prompt, dialog } = usePromptDialog()

  const write = useCallback(async (): Promise<void> => {
    setWriting(true)
    setProblem(null)

    try {
      setTopic(await window.segretarioApi.writeTopicState(topicId))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Non sono riuscito a scrivere il punto.')
    } finally {
      setWriting(false)
    }
  }, [topicId])

  useEffect(() => {
    let current = true

    void window.segretarioApi.getTopic(topicId).then((loaded) => {
      if (!current) {
        return
      }

      setTopic(loaded)

      // What it wrote is stale once a conversation moved after it.
      if (
        loaded &&
        canWrite &&
        loaded.conversations > 0 &&
        (loaded.stateAt === null || (loaded.lastActivityAt ?? 0) > loaded.stateAt)
      ) {
        void write()
      }
    })

    const unsubscribe = window.segretarioApi.onNotesChanged(() => {
      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }

      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null
        void window.segretarioApi.getTopic(topicId).then((loaded) => current && setTopic(loaded))
      }, 1500)
    })

    return () => {
      current = false
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [canWrite, topicId, write])

  if (!topic) {
    return null
  }

  const open = topic.commitments.filter((commitment) => commitment.status === 'aperto')
  const shown = expanded ? open : open.slice(0, COMMITMENTS_SHOWN)

  const update = async (change: { title?: string; archived?: boolean }): Promise<void> => {
    await window.segretarioApi.updateTopic(topic.id, change)
    setTopic(await window.segretarioApi.getTopic(topic.id))
    onChanged()
  }

  return (
    <section
      aria-label={`A che punto è ${topic.title}`}
      className="border-ai-line bg-ai-soft/25 flex max-h-[55%] shrink-0 flex-col gap-2 overflow-y-auto border-b px-4 py-3 select-text"
    >
      <div className="flex items-center gap-2 text-[11.5px]">
        <PenLine className="text-ai size-3.5 shrink-0" />
        <span className="text-ai shrink-0 font-semibold whitespace-nowrap">Il punto</span>
        <span className="text-muted-foreground min-w-0 truncate">
          {formatCount(topic.conversations, 'conversazione', 'conversazioni')}
          {topic.stateAt !== null && ` · scritto ${WRITTEN_AT.format(new Date(topic.stateAt))}`}
          {topic.archived && ' · non più in corso'}
        </span>
        <div className="flex-1" />
        {topic.folderPath && (
          <IconButton
            label="Apri la cartella"
            className="text-muted-foreground size-[24px]"
            onClick={() =>
              void window.segretarioApi
                .openTopicFolder(topic.id)
                .catch((error: unknown) =>
                  setProblem(error instanceof Error ? error.message : 'La cartella non si apre.')
                )
            }
          >
            <FolderOpen className="size-3.5" />
          </IconButton>
        )}
        {canWrite && topic.conversations > 0 && (
          <IconButton
            label="Riscrivi il punto"
            className="text-muted-foreground size-[24px]"
            disabled={writing}
            onClick={() => void write()}
          >
            {writing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </IconButton>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Altro" className="text-muted-foreground size-[24px]">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {topic.origin !== 'extension' && (
              <DropdownMenuItem
                onSelect={() =>
                  void prompt({
                    title: 'Rinomina',
                    label: 'Nome',
                    initialValue: topic.title,
                    confirmLabel: 'Rinomina'
                  }).then((title) => (title ? update({ title }) : undefined))
                }
              >
                <PenLine className="size-3.5" />
                Rinomina…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void update({ archived: !topic.archived })}>
              <Archive className="size-3.5" />
              {topic.archived ? 'Riapri' : 'Chiudi: non è più in corso'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {topic.state ? (
        <div className="flex flex-col items-start gap-0.5">
          <p
            className={cn(
              'voice text-foreground text-[14.5px] leading-[1.5] whitespace-pre-line',
              !stateOpen && 'line-clamp-4',
              writing && 'opacity-60'
            )}
          >
            {topic.state}
          </p>
          {topic.state.length > STATE_CLAMPED_CHARS && (
            <button
              type="button"
              onClick={() => setStateOpen((current) => !current)}
              aria-expanded={stateOpen}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-[12px] outline-none focus-visible:ring-2"
            >
              {stateOpen ? 'Meno' : 'Leggi tutto'}
            </button>
          )}
        </div>
      ) : writing ? (
        <p className="text-muted-foreground flex items-center gap-2 text-[12.5px]">
          <LoaderCircle className="text-ai size-3.5 animate-spin" />
          Rileggo le conversazioni…
        </p>
      ) : (
        topic.conversations === 0 && (
          <p className="text-muted-foreground text-[12.5px]">
            Nessuna conversazione, per ora: quando ne arriva una, la metto qui.
          </p>
        )
      )}
      {problem && <p className="text-destructive-soft-foreground text-[12px]">{problem}</p>}

      {open.length > 0 && (
        <ul className="flex flex-col gap-1">
          {shown.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              onClose={() => void window.segretarioApi.closeCommitment(commitment.id)}
            />
          ))}
          {open.length > COMMITMENTS_SHOWN && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-[12px] outline-none focus-visible:ring-2"
              >
                {expanded ? 'Meno' : `E altre ${open.length - COMMITMENTS_SHOWN}`}
              </button>
            </li>
          )}
        </ul>
      )}
      {dialog}
    </section>
  )
}
