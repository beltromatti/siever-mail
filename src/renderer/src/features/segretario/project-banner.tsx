import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  EyeOff,
  FolderOpen,
  LoaderCircle,
  Merge,
  MoreHorizontal,
  PenLine,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { CompassStar } from '@renderer/components/ui/compass-star'
import { IconButton } from '@renderer/components/ui/icon-button'
import { usePromptDialog } from '@renderer/components/ui/prompt-dialog'
import { cn, formatCount } from '@renderer/lib/utils'
import type { Commitment, Project, ProjectDetail } from '@shared/segretario'

import { CommitmentList } from './commitment-row'

/** About what four lines of "Il punto" hold in the list's width: past it, it folds. */
const STATE_CLAMPED_CHARS = 220
/** Projects offered to merge into this one, the latest moved first. */
const MERGE_OFFERED = 30
/** How long "Il punto" being rewritten is shown, at most, before the banner stops waiting. */
const REWRITE_WAIT_MS = 3 * 60_000

const WRITTEN_AT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

/** "…/Prat2451-HOTEL LIDO" as it reads: its last place. */
function folderName(location: string): string {
  return location.split(/[\\/]/).filter(Boolean).pop() ?? location
}

/**
 * Above the list of a project, the Segretario's word on where it stands —
 * "Il punto", written again when the project moved — what it is about,
 * its folders and what is open in it. The user renames, merges, hides or
 * concludes it from here: their word, which the Segretario keeps.
 */
export function ProjectBanner({
  projectId,
  projects,
  canWrite,
  onRemind,
  onMerged
}: {
  projectId: string
  /** Every project: the others it can be merged with. */
  projects: ReadonlyArray<Project>
  /** The Segretario can work: "Il punto" can be written again. */
  canWrite: boolean
  /** Asks the Segretario for a reminder to who is awaited. */
  onRemind: (commitment: Commitment) => void
  /** The project went into another, or this one took others: the list follows the one kept. */
  onMerged: (keptId: string) => void
}): React.JSX.Element | null {
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [rewritingSince, setRewritingSince] = useState<number | null>(null)
  const [stateOpen, setStateOpen] = useState(false)
  const reloadTimer = useRef<number | null>(null)
  const { prompt, dialog } = usePromptDialog()

  const rewrite = useCallback(async (): Promise<void> => {
    setRewritingSince(Date.now())

    try {
      await window.segretarioApi.refreshProject(projectId)
    } catch (error) {
      setRewritingSince(null)
      toast.error('«Il punto» non si aggiorna', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }, [projectId])

  useEffect(() => {
    let current = true
    let asked = false
    const show = (loaded: ProjectDetail | null, opening: boolean): void => {
      if (!current) {
        return
      }

      setProject(loaded)
      setRewritingSince((since) =>
        since !== null && loaded && (loaded.stateAt ?? 0) >= since ? null : since
      )

      // Behind what happened, it is written again — once, when the project is opened.
      if (opening && loaded && canWrite && loaded.stale && loaded.conversations > 0 && !asked) {
        asked = true
        void rewrite()
      }
    }
    const load = (opening: boolean): void =>
      void window.segretarioApi.getProject(projectId).then((loaded) => show(loaded, opening))

    load(true)

    const unsubscribe = window.segretarioApi.onWorkChanged((change) => {
      if (!change.projectIds.includes(projectId) && change.projectIds.length > 0) {
        return
      }

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }

      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null
        load(false)
      }, 800)
    })

    return () => {
      current = false
      unsubscribe()

      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current)
      }
    }
  }, [canWrite, projectId, rewrite])

  // The rewrite runs in the background: past a while, the banner stops saying so.
  useEffect(() => {
    if (rewritingSince === null) {
      return
    }

    const timer = window.setTimeout(() => setRewritingSince(null), REWRITE_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [rewritingSince])

  if (!project) {
    return null
  }

  const rewriting = rewritingSince !== null
  const folders = project.resources.filter((resource) => resource.kind === 'cartella')
  const others = projects
    .filter((other) => other.id !== project.id && !other.hidden)
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
    .slice(0, MERGE_OFFERED)

  const update = async (change: {
    title?: string
    hidden?: boolean
    closed?: boolean
  }): Promise<void> => {
    try {
      await window.segretarioApi.updateProject(project.id, change)
      setProject(await window.segretarioApi.getProject(project.id))
    } catch (error) {
      toast.error('Il progetto non è cambiato', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const merge = async (other: Project): Promise<void> => {
    try {
      const kept = await window.segretarioApi.mergeProjects(project.id, [other.id])
      toast(`«${other.title}» è ora parte di «${project.title}»`)
      onMerged(kept?.id ?? project.id)
    } catch (error) {
      toast.error('I progetti non si sono uniti', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <section
      aria-label={`A che punto è ${project.title}`}
      className="border-ai-line bg-ai-soft/25 flex max-h-[55%] shrink-0 flex-col gap-2 overflow-y-auto border-b px-4 py-3 select-text"
    >
      <div className="flex items-center gap-2 text-[11.5px]">
        <CompassStar className="text-ai-star size-3.5" />
        <span className="text-ai shrink-0 font-semibold whitespace-nowrap">Il punto</span>
        <span className="text-muted-foreground min-w-0 truncate">
          {formatCount(project.conversations, 'conversazione', 'conversazioni')}
          {project.stateAt !== null && ` · scritto ${WRITTEN_AT.format(new Date(project.stateAt))}`}
          {project.stale && !rewriting && project.stateAt !== null && ' · da aggiornare'}
          {project.closed && ' · concluso'}
          {project.hidden && ' · nascosto'}
        </span>
        <div className="flex-1" />
        {folders.map((folder) => (
          <IconButton
            key={folder.location}
            label={`Apri ${folder.label ?? folderName(folder.location)}`}
            className="text-muted-foreground size-[24px]"
            onClick={() =>
              void window.segretarioApi.openProjectFolder(project.id).catch((error: unknown) =>
                toast.error('La cartella non si apre', {
                  description: error instanceof Error ? error.message : undefined
                })
              )
            }
          >
            <FolderOpen className="size-3.5" />
          </IconButton>
        ))}
        {canWrite && project.conversations > 0 && (
          <IconButton
            label="Aggiorna il punto"
            className="text-muted-foreground size-[24px]"
            disabled={rewriting}
            onClick={() => void rewrite()}
          >
            {rewriting ? (
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
            <DropdownMenuItem
              onSelect={() =>
                void prompt({
                  title: 'Rinomina il progetto',
                  description: 'Il Segretario userà questo nome, e non lo cambierà da solo.',
                  label: 'Nome',
                  initialValue: project.title,
                  confirmLabel: 'Rinomina',
                  validate: (value) => (value.trim() ? null : 'Dai un nome.')
                }).then((title) => (title?.trim() ? update({ title: title.trim() }) : undefined))
              }
            >
              <PenLine className="size-3.5" />
              Rinomina…
            </DropdownMenuItem>
            {others.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Merge className="mr-2 size-3.5" />
                  Unisci a questo
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  {others.map((other) => (
                    <DropdownMenuItem key={other.id} onSelect={() => void merge(other)}>
                      {other.title}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void update({ closed: !project.closed })}>
              <Archive className="size-3.5" />
              {project.closed ? 'Riapri' : 'Concluso: non è più in corso'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void update({ hidden: !project.hidden })}>
              <EyeOff className="size-3.5" />
              {project.hidden ? 'Mostra di nuovo' : 'Nascondi: non è un progetto'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {project.description && (
        <p className="text-muted-foreground text-[12.5px] leading-[1.45]">{project.description}</p>
      )}

      {project.state ? (
        <div className="flex flex-col items-start gap-0.5">
          <p
            className={cn(
              'voice text-foreground text-[14.5px] leading-[1.5] whitespace-pre-line',
              !stateOpen && 'line-clamp-4',
              rewriting && 'opacity-60'
            )}
          >
            {project.state}
          </p>
          {project.state.length > STATE_CLAMPED_CHARS && (
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
      ) : rewriting ? (
        <p className="text-muted-foreground flex items-center gap-2 text-[12.5px]">
          <LoaderCircle className="text-ai size-3.5 animate-spin" />
          Rileggo le conversazioni…
        </p>
      ) : (
        project.conversations === 0 && (
          <p className="text-muted-foreground text-[12.5px]">
            Nessuna conversazione, per ora: quando ne arriva una, la metto qui.
          </p>
        )
      )}

      <CommitmentList commitments={project.commitments} onRemind={onRemind} />
      {dialog}
    </section>
  )
}
