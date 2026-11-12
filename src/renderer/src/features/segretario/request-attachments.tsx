import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, LoaderCircle, X } from 'lucide-react'

import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { AttachmentIcon } from '@renderer/features/mail/attachment-chip'
import { languageNow, messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn, formatByteSize } from '@renderer/lib/utils'
import { defineMessages, type Messages } from '@shared/i18n'
import {
  allotAttachments,
  attachmentGoes,
  REQUEST_ATTACHMENTS,
  type AttachmentInfo,
  type AttachmentShortfall,
  type AttachmentSource,
  type HandleLink,
  type PreparedAttachment,
  type SentAttachment
} from '@shared/segretario'

const MESSAGES = defineMessages({
  attachments: { en: 'Attachments', it: 'Allegati', de: 'Anhänge' },
  pastedPicture: { en: 'Pasted picture', it: 'Immagine incollata', de: 'Eingefügtes Bild' },
  pages: {
    en: (count: number, shown: string) => (count === 1 ? '1 page' : `${shown} pages`),
    it: (count: number, shown: string) => (count === 1 ? '1 pagina' : `${shown} pagine`),
    de: (count: number, shown: string) => (count === 1 ? '1 Seite' : `${shown} Seiten`)
  },
  reading: { en: 'Reading…', it: 'Lo leggo…', de: 'Wird gelesen…' },
  remove: {
    en: (name: string) => `Remove ${name}`,
    it: (name: string) => `Togli ${name}`,
    de: (name: string) => `${name} entfernen`
  },
  open: {
    en: (name: string) => `Open ${name}`,
    it: (name: string) => `Apri ${name}`,
    de: (name: string) => `${name} öffnen`
  },
  tooLong: {
    en: 'Reference only: it’s too long to attach whole',
    it: 'Solo il riferimento: è troppo lungo per allegarlo intero',
    de: 'Nur als Verweis: zu lang, um es ganz anzuhängen'
  },
  tooBig: {
    en: 'Reference only: it’s too big to attach whole',
    it: 'Solo il riferimento: è troppo grande per allegarlo intero',
    de: 'Nur als Verweis: zu groß, um es ganz anzuhängen'
  },
  tooManyPictures: {
    en: 'Reference only: beyond the ten pictures a request carries',
    it: 'Solo il riferimento: oltre le dieci immagini di una richiesta',
    de: 'Nur als Verweis: mehr als die zehn Bilder einer Anfrage'
  },
  unreadable: {
    en: 'Can’t be read: the Segretario will know why',
    it: 'Non si legge: il Segretario saprà perché',
    de: 'Nicht lesbar: Der Segretario erfährt, warum'
  },
  pictureTooBig: {
    en: 'Won’t go: it’s too big to attach',
    it: 'Non va: è troppo grande per allegarla',
    de: 'Wird nicht mitgesendet: zu groß zum Anhängen'
  },
  pictureTooMany: {
    en: 'Won’t go: there are already ten pictures',
    it: 'Non va: ci sono già dieci immagini',
    de: 'Wird nicht mitgesendet: Es sind bereits zehn Bilder dabei'
  },
  pictureUnreadable: {
    en: 'Can’t be read: it won’t go',
    it: 'Non si legge: non va',
    de: 'Nicht lesbar: wird nicht mitgesendet'
  },
  notRead: {
    en: 'It couldn’t be read.',
    it: 'Non si è potuto leggere.',
    de: 'Es konnte nicht gelesen werden.'
  },
  tooMany: {
    en: (count: number) => `At most ${count} attachments per request.`,
    it: (count: number) => `Al massimo ${count} allegati per richiesta.`,
    de: (count: number) => `Höchstens ${count} Anhänge pro Anfrage.`
  }
})

/** An attachment of the request being written: being read, read, or one that cannot be added. */
export type ComposingAttachment =
  | { key: string; state: 'reading'; name: string; path: string | null }
  | { key: string; state: 'ready'; prepared: PreparedAttachment }
  | { key: string; state: 'failed'; name: string; path: string | null; error: string }

/** The files and pictures of the request being written, as the panel keeps them. */
export interface RequestAttachments {
  items: ReadonlyArray<ComposingAttachment>
  /** How each one read goes, by its key: whole (null), or why not. */
  fates: ReadonlyMap<string, AttachmentShortfall | null>
  /** Every one read: nothing goes while one is being read or could not be. */
  ready: boolean
  /** Some go with the request. */
  carriesAny: boolean
  /** Files by their path; says, in words, when more were given than a request carries. */
  addPaths(paths: ReadonlyArray<string>): string | null
  /** Pictures without a file: pasted, or dragged from a page. */
  addPictures(files: ReadonlyArray<File>): string | null
  remove(key: string): void
  /** What the request carries, in order: the ids the main process read them under. */
  ids(): string[]
  /** The request went: what it carried is the main process's now. */
  sent(): void
}

/** What a request's chip says under its name, when it does not go whole: in the user's words. */
function shortfallNote(
  m: Messages<typeof MESSAGES>,
  item: Pick<AttachmentInfo, 'path'>,
  shortfall: AttachmentShortfall | null
): { text: string; warn: boolean } | null {
  if (shortfall === null) {
    return null
  }

  // A picture without a file goes whole or not at all.
  if (item.path === null) {
    return {
      text:
        shortfall === 'unreadable'
          ? m.pictureUnreadable
          : shortfall === 'too-many-pictures'
            ? m.pictureTooMany
            : m.pictureTooBig,
      warn: true
    }
  }

  switch (shortfall) {
    case 'unreadable':
      return { text: m.unreadable, warn: true }
    case 'too-big':
      return { text: m.tooBig, warn: false }
    case 'too-long':
      return { text: m.tooLong, warn: false }
    case 'too-many-pictures':
      return { text: m.tooManyPictures, warn: false }
  }
}

/** Its pages for a PDF that has them, its size otherwise. */
function detailOf(m: Messages<typeof MESSAGES>, item: AttachmentInfo): string {
  return item.pages
    ? m.pages(item.pages, item.pages.toLocaleString(languageNow().formatLocale))
    : formatByteSize(item.size)
}

/**
 * The files and pictures put in the request being written: each read by the
 * main process as it comes — the same reading as `leggi`, whole —, kept
 * there until the request goes; taken out, or left unsent when the panel
 * closes, they are let go.
 */
export function useRequestAttachments(): RequestAttachments {
  const [items, setItems] = useState<ComposingAttachment[]>([])
  const itemsRef = useRef<ComposingAttachment[]>([])
  const mounted = useRef(true)

  const update = useCallback(
    (change: (current: ComposingAttachment[]) => ComposingAttachment[]) => {
      itemsRef.current = change(itemsRef.current)
      setItems(itemsRef.current)
    },
    []
  )

  // Left unsent when the panel closes: what was read for it is let go.
  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      const kept = itemsRef.current.flatMap((item) =>
        item.state === 'ready' ? [item.prepared.id] : []
      )
      itemsRef.current = []

      if (kept.length > 0) {
        void window.segretarioApi.dropAttachments(kept)
      }
    }
  }, [])

  const read = useCallback(
    (key: string, source: Promise<AttachmentSource>, name: string, path: string | null): void => {
      void source
        .then((given) => window.segretarioApi.prepareAttachment(given))
        .then((result) => {
          // Taken out while it was read, or the panel closed: let go at once.
          if (!mounted.current || !itemsRef.current.some((item) => item.key === key)) {
            if (!('error' in result)) {
              void window.segretarioApi.dropAttachments([result.id])
            }

            return
          }

          update((current) =>
            current.map((item) =>
              item.key !== key
                ? item
                : 'error' in result
                  ? { key, state: 'failed', name, path, error: result.error }
                  : { key, state: 'ready', prepared: result }
            )
          )
        })
        .catch((error: unknown) => {
          if (mounted.current) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : messagesNow(MESSAGES).notRead
            update((current) =>
              current.map((item) =>
                item.key === key ? { key, state: 'failed', name, path, error: message } : item
              )
            )
          }
        })
    },
    [update]
  )

  /** Room for more, and the words when some do not fit. */
  const fit = useCallback(
    <T,>(given: ReadonlyArray<T>): { taken: T[]; overflow: string | null } => {
      const room = Math.max(0, REQUEST_ATTACHMENTS.count - itemsRef.current.length)
      return {
        taken: given.slice(0, room),
        overflow:
          given.length > room ? messagesNow(MESSAGES).tooMany(REQUEST_ATTACHMENTS.count) : null
      }
    },
    []
  )

  const addPaths = useCallback(
    (paths: ReadonlyArray<string>): string | null => {
      const present = new Set(
        itemsRef.current.map((item) => (item.state === 'ready' ? item.prepared.path : item.path))
      )
      // The same file twice goes once.
      const fresh = [...new Set(paths)].filter((path) => path && !present.has(path))
      const { taken, overflow } = fit(fresh)
      const added = taken.map((path) => ({
        key: crypto.randomUUID(),
        state: 'reading' as const,
        name: path.split(/[\\/]/).pop() || path,
        path
      }))

      update((current) => [...current, ...added])

      for (const item of added) {
        read(item.key, Promise.resolve({ path: item.path }), item.name, item.path)
      }

      return overflow
    },
    [fit, read, update]
  )

  const addPictures = useCallback(
    (files: ReadonlyArray<File>): string | null => {
      const { taken, overflow } = fit(files)
      const added = taken.map((file) => ({ key: crypto.randomUUID(), file }))
      // Past what a file is read up to, a picture without a file could only go whole: it is not read.
      const fits = ({ file }: { file: File }): boolean => file.size <= REQUEST_ATTACHMENTS.fileBytes

      update((current) => [
        ...current,
        ...added.map((item): ComposingAttachment => {
          const { key, file } = item
          return fits(item)
            ? { key, state: 'reading', name: file.name, path: null }
            : {
                key,
                state: 'failed',
                name: file.name,
                path: null,
                error: messagesNow(MESSAGES).pictureTooBig
              }
        })
      ])

      for (const { key, file } of added.filter(fits)) {
        read(
          key,
          file.arrayBuffer().then((buffer) => ({
            picture: { name: file.name, type: file.type, data: new Uint8Array(buffer) }
          })),
          file.name,
          null
        )
      }

      return overflow
    },
    [fit, read, update]
  )

  const remove = useCallback(
    (key: string): void => {
      const item = itemsRef.current.find((candidate) => candidate.key === key)

      if (item?.state === 'ready') {
        void window.segretarioApi.dropAttachments([item.prepared.id])
      }

      update((current) => current.filter((candidate) => candidate.key !== key))
    },
    [update]
  )

  const ids = useCallback(
    (): string[] =>
      itemsRef.current.flatMap((item) => (item.state === 'ready' ? [item.prepared.id] : [])),
    []
  )

  const sent = useCallback((): void => update(() => []), [update])

  const fates = useMemo(() => {
    const done = items.flatMap((item) => (item.state === 'ready' ? [item] : []))
    const allotted = allotAttachments(done.map((item) => item.prepared))
    return new Map(done.map((item, index) => [item.key, allotted[index]] as const))
  }, [items])

  return {
    items,
    fates,
    ready: items.every((item) => item.state === 'ready'),
    carriesAny: items.some(
      (item) => item.state === 'ready' && attachmentGoes(item.prepared, fates.get(item.key) ?? null)
    ),
    addPaths,
    addPictures,
    remove,
    ids,
    sent
  }
}

/**
 * One attachment as a chip — its picture or its icon, its name, its size or
 * pages — and, when it does not go whole, why: a second line, never hidden
 * in a tooltip. The mail's attachment chip, with what a request needs more.
 */
function RequestAttachmentChip({
  name,
  info,
  busy = false,
  error,
  note,
  onOpen,
  onRemove
}: {
  name: string
  info: AttachmentInfo | null
  busy?: boolean
  error?: string
  note?: { text: string; warn: boolean } | null
  onOpen?: () => void
  onRemove?: () => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const detail = info ? detailOf(m, info) : busy ? m.reading : null
  const glyph = busy ? (
    <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
  ) : error ? (
    <CircleAlert className="text-destructive size-3.5 shrink-0" />
  ) : info?.thumbnail ? (
    <img
      src={info.thumbnail}
      alt=""
      className="size-4.5 shrink-0 rounded-md object-cover shadow-[inset_0_0_0_1px_hsl(var(--border))]"
    />
  ) : (
    <AttachmentIcon fileName={name} className="text-muted-foreground size-3.5 shrink-0" />
  )
  const body = (
    <span className="flex min-w-0 items-center gap-1.5">
      {glyph}
      <span className="max-w-48 truncate text-[11.5px] font-medium">{name}</span>
      {detail && (
        <span className="text-muted-foreground shrink-0 text-[10.5px] tabular-nums">{detail}</span>
      )}
    </span>
  )
  const why = error ?? note?.text

  return (
    <li
      aria-busy={busy || undefined}
      className={cn(
        'border-border/70 bg-card/60 flex max-w-full min-w-0 flex-col justify-center rounded-md border py-0.75 pl-2',
        onRemove ? 'pr-0.5' : 'pr-2',
        onOpen && 'hover:border-border hover:bg-card transition-colors',
        error && 'border-destructive/50',
        busy && 'opacity-75'
      )}
    >
      <span className="flex min-h-5 min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                aria-label={m.open(name)}
                className="focus-visible:ring-ring/70 flex min-w-0 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2"
              >
                {body}
              </button>
            ) : (
              body
            )}
          </TooltipTrigger>
          <TooltipContent side="top">
            {name}
            {detail && (
              <span className="text-muted-foreground block text-[10.5px] font-normal">
                {detail}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
        {onRemove && (
          <IconButton
            label={m.remove(name)}
            tooltipSide="top"
            className="text-faint-foreground size-5"
            onClick={onRemove}
          >
            <X className="size-3" />
          </IconButton>
        )}
      </span>
      {why && (
        <span
          className={cn(
            'pb-px text-[10.5px] leading-[1.35]',
            error
              ? 'text-destructive-soft-foreground'
              : note?.warn
                ? 'text-warning'
                : 'text-muted-foreground'
          )}
        >
          {why}
        </span>
      )}
    </li>
  )
}

/** The chips of the request being written, above its words. */
export function ComposingAttachments({
  attachments
}: {
  attachments: RequestAttachments
}): React.JSX.Element | null {
  const m = useMessages(MESSAGES)

  if (attachments.items.length === 0) {
    return null
  }

  return (
    <ul aria-label={m.attachments} className="mb-1.5 flex flex-wrap gap-1.5">
      {attachments.items.map((item) => {
        const remove = (): void => attachments.remove(item.key)

        switch (item.state) {
          case 'reading':
            return (
              <RequestAttachmentChip
                key={item.key}
                name={item.path === null ? m.pastedPicture : item.name}
                info={null}
                busy
                onRemove={remove}
              />
            )
          case 'failed':
            return (
              <RequestAttachmentChip
                key={item.key}
                name={item.path === null ? m.pastedPicture : item.name}
                info={null}
                error={item.error}
                onRemove={remove}
              />
            )
          case 'ready': {
            const { prepared } = item
            return (
              <RequestAttachmentChip
                key={item.key}
                name={prepared.path === null ? m.pastedPicture : prepared.name}
                info={prepared}
                note={shortfallNote(m, prepared, attachments.fates.get(item.key) ?? null)}
                onRemove={remove}
              />
            )
          }
        }
      })}
    </ul>
  )
}

/** What went with the user's words, under them: a click opens a file where it is. */
export function SentAttachments({
  attachments,
  onOpen
}: {
  attachments: ReadonlyArray<SentAttachment>
  onOpen: (link: HandleLink) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)

  return (
    <ul aria-label={m.attachments} className="flex max-w-[88%] flex-wrap justify-end gap-1.5">
      {attachments.map((attachment, index) => {
        const { path } = attachment

        return (
          <RequestAttachmentChip
            key={`${index}\u0000${attachment.name}`}
            name={path === null ? m.pastedPicture : attachment.name}
            info={attachment}
            note={shortfallNote(m, attachment, attachment.shortfall)}
            onOpen={
              path
                ? () =>
                    onOpen({
                      handle: attachment.handle ?? '',
                      kind: 'file',
                      fileName: attachment.name,
                      path
                    })
                : undefined
            }
          />
        )
      })}
    </ul>
  )
}
