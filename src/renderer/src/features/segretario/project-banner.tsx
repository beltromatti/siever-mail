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
import { hourStyle, languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn, formatCount } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import { PLACES } from '@shared/places'
import type { Commitment, Project, ProjectDetail } from '@shared/segretario'

import { CommitmentList } from './commitment-row'
import { LinkedWords } from './segretario-text'

/** About what four lines of "Il punto" hold in the list's width: past it, it folds. */
const STATE_CLAMPED_CHARS = 220
/** Projects offered to merge into this one, the latest moved first. */
const MERGE_OFFERED = 30
/** How long "Il punto" being rewritten is shown, at most, before the banner stops waiting. */
const REWRITE_WAIT_MS = 3 * 60_000

/** Made when used: the hour is written as the region writes it now. */
const WRITTEN_AT = (): Intl.DateTimeFormatOptions => ({
  day: 'numeric',
  month: 'short',
  hour: hourStyle(),
  minute: '2-digit'
})

const MESSAGES = defineMessages({
  notRewritten: {
    en: (place: string) => `“${place}” didn’t update`,
    it: (place: string) => `«${place}» non si aggiorna`,
    de: (place: string) => `„${place}“ wurde nicht aktualisiert`
  },
  notChanged: {
    en: 'The project didn’t change',
    it: 'Il progetto non è cambiato',
    de: 'Das Projekt wurde nicht geändert'
  },
  merged: {
    en: (other: string, kept: string) => `“${other}” is now part of “${kept}”`,
    it: (other: string, kept: string) => `«${other}» è ora parte di «${kept}»`,
    de: (other: string, kept: string) => `„${other}“ ist jetzt Teil von „${kept}“`
  },
  notMerged: {
    en: 'The projects weren’t merged',
    it: 'I progetti non si sono uniti',
    de: 'Die Projekte wurden nicht zusammengeführt'
  },
  sectionLabel: {
    en: (project: string) => `Where ${project} stands`,
    it: (project: string) => `A che punto è ${project}`,
    de: (project: string) => `Stand der Dinge: ${project}`
  },
  conversation: { en: 'conversation', it: 'conversazione', de: 'Unterhaltung' },
  conversations: { en: 'conversations', it: 'conversazioni', de: 'Unterhaltungen' },
  written: {
    en: (at: string) => ` · written ${at}`,
    it: (at: string) => ` · scritto ${at}`,
    de: (at: string) => ` · geschrieben am ${at}`
  },
  stale: { en: ' · needs updating', it: ' · da aggiornare', de: ' · zu aktualisieren' },
  closed: { en: ' · completed', it: ' · concluso', de: ' · abgeschlossen' },
  hidden: { en: ' · hidden', it: ' · nascosto', de: ' · ausgeblendet' },
  open: {
    en: (name: string) => `Open ${name}`,
    it: (name: string) => `Apri ${name}`,
    de: (name: string) => `${name} öffnen`
  },
  folderNotOpened: {
    en: 'The folder didn’t open',
    it: 'La cartella non si apre',
    de: 'Der Ordner ließ sich nicht öffnen'
  },
  rewrite: {
    en: 'Update where it stands',
    it: 'Aggiorna il punto',
    de: 'Stand der Dinge aktualisieren'
  },
  more: { en: 'More', it: 'Altro', de: 'Mehr' },
  renameTitle: { en: 'Rename the project', it: 'Rinomina il progetto', de: 'Projekt umbenennen' },
  renameText: {
    en: 'The Segretario will use this name, and won’t change it on its own.',
    it: 'Il Segretario userà questo nome, e non lo cambierà da solo.',
    de: 'Der Segretario verwendet diesen Namen und ändert ihn nicht von sich aus.'
  },
  name: { en: 'Name', it: 'Nome', de: 'Name' },
  rename: { en: 'Rename', it: 'Rinomina', de: 'Umbenennen' },
  nameNeeded: { en: 'Give it a name.', it: 'Dai un nome.', de: 'Geben Sie einen Namen ein.' },
  renameMenu: { en: 'Rename…', it: 'Rinomina…', de: 'Umbenennen…' },
  mergeInto: { en: 'Merge into this one', it: 'Unisci a questo', de: 'Mit diesem zusammenführen' },
  reopen: { en: 'Reopen', it: 'Riapri', de: 'Wieder öffnen' },
  close: {
    en: 'Completed: no longer in progress',
    it: 'Concluso: non è più in corso',
    de: 'Abgeschlossen: nicht mehr laufend'
  },
  show: { en: 'Show again', it: 'Mostra di nuovo', de: 'Wieder anzeigen' },
  hide: {
    en: 'Hide: not a project',
    it: 'Nascondi: non è un progetto',
    de: 'Ausblenden: kein Projekt'
  },
  less: { en: 'Less', it: 'Meno', de: 'Weniger' },
  readAll: { en: 'Read more', it: 'Leggi tutto', de: 'Alles lesen' },
  rereading: {
    en: 'Rereading the conversations…',
    it: 'Rileggo le conversazioni…',
    de: 'Ich lese die Unterhaltungen erneut…'
  },
  noConversations: {
    en: 'No conversations yet: when one arrives, I’ll put it here.',
    it: 'Nessuna conversazione, per ora: quando ne arriva una, la metto qui.',
    de: 'Noch keine Unterhaltung: Sobald eine eintrifft, lege ich sie hier ab.'
  }
})

/** "…/Clienti/Casa al mare" as it reads: its last place. */
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
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
      toast.error(messagesNow(MESSAGES).notRewritten(messagesNow(PLACES).whereItStands), {
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
      toast.error(messagesNow(MESSAGES).notChanged, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  const merge = async (other: Project): Promise<void> => {
    try {
      const kept = await window.segretarioApi.mergeProjects(project.id, [other.id])
      toast(messagesNow(MESSAGES).merged(other.title, project.title))
      onMerged(kept?.id ?? project.id)
    } catch (error) {
      toast.error(messagesNow(MESSAGES).notMerged, {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <section
      aria-label={m.sectionLabel(project.title)}
      className="border-ai-line bg-ai-soft/25 flex max-h-[55%] shrink-0 flex-col gap-2 overflow-y-auto border-b px-4 py-3 select-text"
    >
      <div className="flex items-center gap-2 text-[11.5px]">
        <CompassStar className="text-ai-star size-3.5" />
        <span className="text-ai shrink-0 font-semibold whitespace-nowrap">
          {places.whereItStands}
        </span>
        <span className="text-muted-foreground min-w-0 truncate">
          {formatCount(project.conversations, m.conversation, m.conversations)}
          {project.stateAt !== null &&
            m.written(
              new Intl.DateTimeFormat(languageNow().formatLocale, WRITTEN_AT()).format(
                new Date(project.stateAt)
              )
            )}
          {project.stale && !rewriting && project.stateAt !== null && m.stale}
          {project.closed && m.closed}
          {project.hidden && m.hidden}
        </span>
        <div className="flex-1" />
        {folders.map((folder) => (
          <IconButton
            key={folder.location}
            label={m.open(folder.label ?? folderName(folder.location))}
            className="text-muted-foreground size-[24px]"
            onClick={() =>
              void window.segretarioApi.openProjectFolder(project.id).catch((error: unknown) =>
                toast.error(messagesNow(MESSAGES).folderNotOpened, {
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
            label={m.rewrite}
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
            <IconButton label={m.more} className="text-muted-foreground size-[24px]">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void prompt({
                  title: m.renameTitle,
                  description: m.renameText,
                  label: m.name,
                  initialValue: project.title,
                  confirmLabel: m.rename,
                  validate: (value) => (value.trim() ? null : m.nameNeeded)
                }).then((title) => (title?.trim() ? update({ title: title.trim() }) : undefined))
              }
            >
              <PenLine className="size-3.5" />
              {m.renameMenu}
            </DropdownMenuItem>
            {others.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Merge className="mr-2 size-3.5" />
                  {m.mergeInto}
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
              {project.closed ? m.reopen : m.close}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void update({ hidden: !project.hidden })}>
              <EyeOff className="size-3.5" />
              {project.hidden ? m.show : m.hide}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {project.description && (
        <p className="text-muted-foreground text-[12.5px] leading-[1.45]">{project.description}</p>
      )}

      {project.state ? (
        <div className="flex flex-col items-start gap-0.5">
          <LinkedWords
            text={project.state}
            links={project.stateLinks}
            className={cn(
              'text-foreground text-[14.5px] leading-[1.5]',
              !stateOpen && 'line-clamp-4',
              rewriting && 'opacity-60'
            )}
          />
          {project.state.length > STATE_CLAMPED_CHARS && (
            <button
              type="button"
              onClick={() => setStateOpen((current) => !current)}
              aria-expanded={stateOpen}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 rounded-sm text-[12px] outline-none focus-visible:ring-2"
            >
              {stateOpen ? m.less : m.readAll}
            </button>
          )}
        </div>
      ) : rewriting ? (
        <p className="text-muted-foreground flex items-center gap-2 text-[12.5px]">
          <LoaderCircle className="text-ai size-3.5 animate-spin" />
          {m.rereading}
        </p>
      ) : (
        project.conversations === 0 && (
          <p className="text-muted-foreground text-[12.5px]">{m.noConversations}</p>
        )
      )}

      <CommitmentList commitments={project.commitments} onRemind={onRemind} />
      {dialog}
    </section>
  )
}
