import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  LoaderCircle,
  type LucideIcon
} from 'lucide-react'
import * as React from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn, formatByteSize } from '@renderer/lib/utils'

/**
 * Extension groups, in the order a business user meets them. Matching on the
 * extension rather than the MIME type is deliberate: a real mailbox is full
 * of parts typed `application/octet-stream` whose name still ends in `.pdf`,
 * and the name is what the user recognises anyway.
 */
const EXTENSION_ICONS: ReadonlyArray<readonly [RegExp, LucideIcon]> = [
  [/\.(pdf)$/i, FileText],
  [/\.(docx?|odt|rtf|pages)$/i, FileText],
  [/\.(xlsx?|xlsm|csv|ods|numbers)$/i, FileSpreadsheet],
  [/\.(pptx?|odp|key)$/i, FileImage],
  [/\.(png|jpe?g|gif|bmp|webp|svg|heic|tiff?)$/i, FileImage],
  [/\.(zip|rar|7z|tar|gz|bz2)$/i, FileArchive],
  [/\.(mp3|wav|m4a|aac|flac|ogg)$/i, FileAudio],
  [/\.(mp4|mov|avi|mkv|webm|wmv)$/i, FileVideo],
  [/\.(xml|json|ya?ml|html?|js|ts|p7m|eml|msg)$/i, FileCode]
]

function attachmentIcon(fileName: string): LucideIcon {
  return EXTENSION_ICONS.find(([pattern]) => pattern.test(fileName))?.[1] ?? File
}

/**
 * Built with `createElement` rather than `<Icon />`: the icon is chosen at
 * runtime from the file name, and rendering a capitalised local binding as
 * JSX is what "components created during render" warns about — it cannot
 * tell a lookup in a constant table from a component defined on the fly.
 */
function AttachmentIcon({
  fileName,
  className
}: {
  fileName: string
  className?: string
}): React.JSX.Element {
  return React.createElement(attachmentIcon(fileName), { className })
}

export interface AttachmentChipProps {
  fileName: string
  sizeBytes: number
  /** What happens on click — download in the reader, nothing in the composer. */
  onOpen?: () => void
  /** Rendered at the trailing edge: remove in the composer, nothing in the reader. */
  trailing?: React.ReactNode
  busy?: boolean
  className?: string
}

/**
 * One attachment, as a single-line chip.
 *
 * These used to be two-line cards laid out in a two-column grid, in both the
 * reader and the composer: a message with four attachments spent over 100px
 * of vertical space restating what four short filenames already said, and
 * the MIME type sat under each name where nobody needed it. A chip is the
 * shape the content actually has — a name, a size, one action — so several
 * fit on a line and the eye scans them as a list rather than a wall.
 *
 * The same component serves both sides so an attachment looks identical
 * whether it is arriving or leaving.
 */
export function AttachmentChip({
  fileName,
  sizeBytes,
  onOpen,
  trailing,
  busy = false,
  className
}: AttachmentChipProps): React.JSX.Element {
  const size = formatByteSize(sizeBytes)
  const interactive = Boolean(onOpen)

  const body = (
    <span className="flex min-w-0 items-center gap-1.5">
      {busy ? (
        <LoaderCircle className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
      ) : (
        <AttachmentIcon fileName={fileName} className="text-muted-foreground size-3.5 shrink-0" />
      )}
      {/*
        The name gets a ceiling rather than a fixed width: short names stay
        short so more chips fit on a line, and a long one truncates instead
        of pushing its neighbours off the row.
      */}
      <span className="max-w-56 truncate text-[11.5px] font-medium">{fileName}</span>
      <span className="text-muted-foreground shrink-0 text-[10.5px] tabular-nums">{size}</span>
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'border-border/70 bg-card/60 inline-flex h-6.5 max-w-full items-center gap-1 rounded-md border pr-1 pl-2 transition-colors',
            interactive && 'hover:border-border hover:bg-card cursor-pointer',
            busy && 'pointer-events-none opacity-70',
            className
          )}
        >
          {interactive ? (
            <button
              type="button"
              onClick={onOpen}
              disabled={busy}
              aria-label={`Scarica ${fileName}`}
              className="focus-visible:ring-ring/70 flex min-w-0 items-center rounded-sm outline-none focus-visible:ring-2"
            >
              {body}
            </button>
          ) : (
            body
          )}
          {trailing}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {fileName}
        <span className="text-muted-foreground block text-[10.5px] font-normal">
          {size}
          {interactive && ' · clicca per scaricare'}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
