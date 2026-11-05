import { createContext, memo, useContext, useMemo } from 'react'
import { Briefcase, CalendarDays, FileText, ListChecks, Mail, PenLine } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { cn } from '@renderer/lib/utils'
import type { HandleLink } from '@shared/segretario'
import {
  COMMITMENT_LINK_PATTERN,
  HANDLE_LINK_PATTERN,
  SCHEME_OF_HANDLE
} from '@shared/segretario-links'

const INTERNAL_LINK_PREFIX = '#segretario/'

/**
 * The Segretario writes links to what it found as `[testo](mail:m4)`,
 * `(file:f2)`, `(bozza:b1)`, `(progetto:p1)`, `(evento:e1)` — now and then
 * as the short name alone, `(m4)`, which says as much — and to an open
 * thing as `(impegno:12)`. They become internal anchors before the
 * markdown is read — a sanitiser would drop an unknown scheme — and chips
 * when drawn.
 */
function internalizeLinks(markdown: string): string {
  return markdown
    .replace(
      new RegExp(HANDLE_LINK_PATTERN),
      (_match, _scheme: string | undefined, handle: string) =>
        `](${INTERNAL_LINK_PREFIX}${SCHEME_OF_HANDLE[handle[0].toLowerCase()]}/${handle.toLowerCase()})`
    )
    .replace(
      new RegExp(COMMITMENT_LINK_PATTERN),
      (_match, id: string) => `](${INTERNAL_LINK_PREFIX}impegno/${id})`
    )
}

const CHIP_ICONS = {
  message: Mail,
  file: FileText,
  draft: PenLine,
  project: Briefcase,
  event: CalendarDays,
  commitment: ListChecks
} as const

/**
 * What the Segretario writes, set as writing — in serif — with its links to
 * messages, files and drafts drawn as chips that open them.
 */
export const SegretarioText = memo(function SegretarioText({
  text,
  streaming = false,
  handles,
  onOpen,
  className
}: {
  text: string
  streaming?: boolean
  handles: ReadonlyMap<string, HandleLink>
  onOpen: (link: HandleLink) => void
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('segretario-text voice text-[15px] leading-[1.55]', className)}>
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        isAnimating={streaming}
        parseIncompleteMarkdown
        controls={false}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(INTERNAL_LINK_PREFIX)) {
              const [scheme, handle] = href.slice(INTERNAL_LINK_PREFIX.length).split('/')
              // An open thing's number holds everywhere: it needs no name from the run.
              const link: HandleLink | undefined =
                scheme === 'impegno'
                  ? { handle: `#${handle}`, kind: 'commitment', commitmentId: Number(handle) }
                  : handles.get(handle)

              if (!link) {
                return <span className="text-muted-foreground">{children}</span>
              }

              const Icon = CHIP_ICONS[link.kind]

              return (
                <button
                  type="button"
                  onClick={() => onOpen(link)}
                  className="bg-hover text-foreground hover:bg-selected focus-visible:ring-ring/60 mx-px inline-flex max-w-full translate-y-[-1px] items-baseline gap-1 rounded-[5px] px-1.5 py-px align-baseline font-sans text-[12.5px] font-medium shadow-[inset_0_0_0_1px_hsl(var(--border))] outline-none focus-visible:ring-2"
                >
                  <Icon className="text-ai size-3 shrink-0 self-center" />
                  <span className="truncate">{children}</span>
                </button>
              )
            }

            // A link to anything but the web or a mail address (a note's
            // path, a made-up scheme) leads nowhere: it reads as text.
            if (!href || !/^(https?:|mailto:)/i.test(href)) {
              return <span>{children}</span>
            }

            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()

                  if (href) {
                    void window.mailApi.openExternalUrl(href)
                  }
                }}
                className="text-foreground underline decoration-[hsl(var(--input))] underline-offset-2"
              >
                {children}
              </a>
            )
          }
        }}
      >
        {internalizeLinks(text)}
      </Streamdown>
    </div>
  )
})

/** Where the app opens what a link of the Segretario points at: given once, at the top. */
const OpenLinkContext = createContext<(link: HandleLink) => void>(() => undefined)

export const SegretarioLinkProvider = OpenLinkContext.Provider

/**
 * Words of the Segretario that stay — the letter of Oggi, "Il punto", a
 * meeting's preparation — set like the rest of its writing, their links
 * opening what they pointed at when they were written.
 */
export function LinkedWords({
  text,
  links,
  className
}: {
  text: string
  links: ReadonlyArray<HandleLink>
  className?: string
}): React.JSX.Element {
  const open = useContext(OpenLinkContext)
  const handles = useMemo(() => new Map(links.map((link) => [link.handle, link])), [links])

  return <SegretarioText text={text} handles={handles} onOpen={open} className={className} />
}
