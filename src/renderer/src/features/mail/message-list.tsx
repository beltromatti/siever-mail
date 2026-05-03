import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CheckCheck, ListChecks, Paperclip } from 'lucide-react'

import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { cn, formatAddress, formatDateLabel } from '@renderer/lib/utils'
import { initialsFromName } from '@renderer/lib/email'
import { MESSAGE_LIST_PAGE_SIZE, type MailMessageSummary, type MessageRef } from '@shared/models'

interface MessageListProps {
  title?: string
  messages: MailMessageSummary[]
  totalCount: number
  selectedMessage: MessageRef | null
  multiSelectEnabled: boolean
  selectedMessageRefs: MessageRef[]
  allVisibleSelected: boolean
  canLoadMoreMessages: boolean
  loadingMoreMessages: boolean
  compact?: boolean
  onSelectMessage: (ref: MessageRef, options?: { activateMultiSelect?: boolean }) => void
  onOpenMessage: (ref: MessageRef) => void
  onLoadMoreMessages: () => void
  onToggleMultiSelect: () => void
  onSelectAllVisible: () => void
}

const WRAP_SAFETY_PADDING_PX = 18
const TRUNCATION_ELLIPSIS = '...'
const MESSAGE_CARD_TEXT_MAX_CHARACTERS = 140
const MESSAGE_CARD_TEXT_COMPACT_MAX_CHARACTERS = 74
const navigatorPlatform =
  typeof navigator !== 'undefined'
    ? 'userAgentData' in navigator
      ? ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform)
      : navigator.platform
    : ''
const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigatorPlatform)
let measureContext: CanvasRenderingContext2D | null = null

function senderLabel(message: MailMessageSummary): string {
  const first = message.from[0]

  if (!first) {
    return 'Mittente sconosciuto'
  }

  return first.name || first.address
}

function recipientsLabel(message: MailMessageSummary): string {
  const recipients = message.to.length > 0 ? message.to : message.cc

  if (recipients.length === 0) {
    return 'A: N/D'
  }

  return `A: ${recipients.map(formatAddress).join(', ')}`
}

function messageRefKey(ref: MessageRef): string {
  return `${ref.accountId}:${ref.folderPath}:${ref.uid}`
}

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext) {
    return measureContext
  }

  if (typeof document === 'undefined') {
    return null
  }

  const canvas = document.createElement('canvas')
  measureContext = canvas.getContext('2d')
  return measureContext
}

function wrapLongWord(
  word: string,
  maxWidthPx: number,
  context: CanvasRenderingContext2D
): string[] {
  if (!word) {
    return []
  }

  const chunks: string[] = []
  let currentChunk = ''

  for (const char of word) {
    const nextChunk = `${currentChunk}${char}`

    if (currentChunk && context.measureText(nextChunk).width > maxWidthPx) {
      chunks.push(currentChunk)
      currentChunk = char
      continue
    }

    currentChunk = nextChunk
  }

  if (currentChunk) {
    chunks.push(currentChunk)
  }

  return chunks
}

function wrapSingleLine(
  line: string,
  maxWidthPx: number,
  context: CanvasRenderingContext2D
): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return ['']
  }

  const wrapped: string[] = []
  let currentLine = ''

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word

    if (context.measureText(nextLine).width <= maxWidthPx) {
      currentLine = nextLine
      continue
    }

    if (currentLine) {
      wrapped.push(currentLine)
      currentLine = ''
    }

    if (context.measureText(word).width <= maxWidthPx) {
      currentLine = word
      continue
    }

    const wordChunks = wrapLongWord(word, maxWidthPx, context)

    if (wordChunks.length === 0) {
      continue
    }

    wrapped.push(...wordChunks.slice(0, -1))
    currentLine = wordChunks[wordChunks.length - 1] || ''
  }

  if (currentLine) {
    wrapped.push(currentLine)
  }

  return wrapped.length > 0 ? wrapped : ['']
}

function wrapTextByWidth(text: string, maxWidthPx: number, font: string): string {
  const context = getMeasureContext()

  if (!context || !Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
    return text
  }

  context.font = font
  const lines = text.split(/\r?\n/)
  const wrappedLines = lines.flatMap((line) => wrapSingleLine(line, maxWidthPx, context))
  return wrappedLines.join('\n')
}

function lineCountForTextByWidth(text: string, maxWidthPx: number, font: string): number {
  const wrapped = wrapTextByWidth(text, maxWidthPx, font)
  return wrapped.split('\n').length
}

function isMultiSelectModifierPressed(event: MouseEvent<HTMLButtonElement>): boolean {
  return IS_MAC_PLATFORM ? event.metaKey : event.ctrlKey
}

function truncateTextByLines(
  text: string,
  maxWidthPx: number,
  font: string,
  maxLines: number
): string {
  const normalizedMaxLines = Math.max(1, Math.floor(maxLines))

  if (!text.trim()) {
    return text
  }

  if (lineCountForTextByWidth(text, maxWidthPx, font) <= normalizedMaxLines) {
    return text
  }

  let bestLength = 0
  let low = 0
  let high = text.length

  while (low <= high) {
    const candidateLength = Math.floor((low + high) / 2)
    const candidate = `${text.slice(0, candidateLength).trimEnd()}${TRUNCATION_ELLIPSIS}`
    const candidateLineCount = lineCountForTextByWidth(candidate, maxWidthPx, font)

    if (candidateLineCount <= normalizedMaxLines) {
      bestLength = candidateLength
      low = candidateLength + 1
      continue
    }

    high = candidateLength - 1
  }

  return `${text.slice(0, bestLength).trimEnd()}${TRUNCATION_ELLIPSIS}`
}

function AutoWrappedText({
  text,
  className,
  maxLines,
  maxCharacters
}: {
  text: string
  className: string
  maxLines?: number
  maxCharacters?: number
}): React.JSX.Element {
  const textRef = useRef<HTMLParagraphElement | null>(null)
  const [wrappedText, setWrappedText] = useState(text)

  useEffect(() => {
    const element = textRef.current

    if (!element) {
      return
    }

    const updateWrap = (): void => {
      const computedStyle = window.getComputedStyle(element)
      const font = [
        computedStyle.fontStyle,
        computedStyle.fontVariant,
        computedStyle.fontWeight,
        computedStyle.fontSize,
        computedStyle.fontFamily
      ]
        .filter(Boolean)
        .join(' ')
      const maxWidthPx = Math.max(40, element.clientWidth - WRAP_SAFETY_PADDING_PX)
      const normalizedMaxCharacters =
        typeof maxCharacters === 'number' && Number.isFinite(maxCharacters)
          ? Math.max(1, Math.floor(maxCharacters))
          : null
      const normalizedByCharacterLimit =
        normalizedMaxCharacters && text.length > normalizedMaxCharacters
          ? `${text.slice(0, normalizedMaxCharacters).trimEnd()}${TRUNCATION_ELLIPSIS}`
          : text
      const normalizedByLineLimit =
        typeof maxLines === 'number' && Number.isFinite(maxLines)
          ? truncateTextByLines(normalizedByCharacterLimit, maxWidthPx, font, maxLines)
          : normalizedByCharacterLimit

      setWrappedText(wrapTextByWidth(normalizedByLineLimit, maxWidthPx, font))
    }

    updateWrap()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      updateWrap()
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [maxCharacters, maxLines, text])

  return (
    <p ref={textRef} className={className}>
      {wrappedText}
    </p>
  )
}

export function MessageList({
  title = 'Conversazioni',
  messages,
  totalCount,
  selectedMessage,
  multiSelectEnabled,
  selectedMessageRefs,
  allVisibleSelected,
  canLoadMoreMessages,
  loadingMoreMessages,
  compact = false,
  onSelectMessage,
  onOpenMessage,
  onLoadMoreMessages,
  onToggleMultiSelect,
  onSelectAllVisible
}: MessageListProps): React.JSX.Element {
  const selectedMessageRefKeys = useMemo(
    () => new Set(selectedMessageRefs.map((ref) => messageRefKey(ref))),
    [selectedMessageRefs]
  )
  const resultsLabel =
    totalCount > messages.length ? `${messages.length} di ${totalCount}` : `${messages.length}`
  const hasMessages = messages.length > 0
  const showMultiSelectToggle = hasMessages || multiSelectEnabled
  const showSelectAll = multiSelectEnabled && hasMessages && !allVisibleSelected

  return (
    <div
      className={cn(
        'glass-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl p-3',
        compact && 'p-2.5'
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h3 className={cn('display-title text-xl', compact && 'text-lg')}>{title}</h3>
          <p className="text-muted-foreground text-xs">{resultsLabel} risultati</p>
        </div>

        {(showMultiSelectToggle || showSelectAll) && (
          <TooltipProvider delayDuration={120}>
            <div className="flex shrink-0 items-center gap-1">
              {showSelectAll && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={onSelectAllVisible}
                      aria-label="Seleziona tutto"
                    >
                      <CheckCheck className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Seleziona tutto</TooltipContent>
                </Tooltip>
              )}

              {showMultiSelectToggle && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={multiSelectEnabled ? 'secondary' : 'outline'}
                      size="icon"
                      className="size-8"
                      onClick={onToggleMultiSelect}
                      aria-label={
                        multiSelectEnabled ? 'Esci dalla multi-selezione' : 'Multi-selezione'
                      }
                    >
                      <ListChecks className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {multiSelectEnabled ? 'Esci dalla multi-selezione' : 'Multi-selezione'}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </TooltipProvider>
        )}
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div className={cn('min-w-0 space-y-1.5 pr-2', compact && 'space-y-1 pr-1.5')}>
          {messages.map((message) => {
            const messageRef = {
              accountId: message.accountId,
              folderPath: message.folderPath,
              uid: message.uid
            } satisfies MessageRef
            const isActive =
              selectedMessage?.accountId === messageRef.accountId &&
              selectedMessage?.folderPath === messageRef.folderPath &&
              selectedMessage?.uid === messageRef.uid
            const isMultiSelected = selectedMessageRefKeys.has(messageRefKey(messageRef))

            const sender = senderLabel(message)
            const recipients = recipientsLabel(message)
            const maxTextCharacters = compact
              ? MESSAGE_CARD_TEXT_COMPACT_MAX_CHARACTERS
              : MESSAGE_CARD_TEXT_MAX_CHARACTERS

            return (
              <Button
                key={messageRefKey(messageRef)}
                variant="ghost"
                className={cn(
                  'h-auto w-full max-w-full min-w-0 items-start justify-start rounded-lg border border-transparent px-3 py-2 text-left whitespace-normal',
                  compact && 'px-2.5 py-2',
                  isMultiSelected && 'border-primary/55 bg-primary/10 hover:bg-primary/15',
                  isActive
                    ? 'border-primary/45 bg-primary/10 text-foreground hover:bg-primary/15'
                    : 'hover:border-border/65 hover:bg-secondary/45'
                )}
                onClick={(event) => {
                  if (event.detail > 1) {
                    return
                  }

                  onSelectMessage(
                    messageRef,
                    isMultiSelectModifierPressed(event) ? { activateMultiSelect: true } : undefined
                  )
                }}
                onDoubleClick={() => onOpenMessage(messageRef)}
              >
                {multiSelectEnabled && !compact && (
                  <span
                    className={cn(
                      'mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                      isMultiSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background/55 text-transparent'
                    )}
                  >
                    <Check className="size-3" />
                  </span>
                )}

                <Avatar className={cn('border-border border', compact ? 'size-8' : 'size-9')}>
                  <AvatarFallback
                    className={cn('bg-secondary/90', compact ? 'text-[10px]' : 'text-[11px]')}
                  >
                    {initialsFromName(sender)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <p
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        compact ? 'text-[13px]' : 'text-sm',
                        message.isRead ? 'font-medium' : 'font-bold'
                      )}
                    >
                      {sender}
                    </p>
                    <p
                      className={cn(
                        'text-muted-foreground shrink-0',
                        compact ? 'text-[10px]' : 'text-[11px]'
                      )}
                    >
                      {formatDateLabel(message.date)}
                    </p>
                  </div>
                  <AutoWrappedText
                    text={recipients}
                    maxLines={1}
                    maxCharacters={maxTextCharacters}
                    className={cn(
                      'text-muted-foreground max-w-full min-w-0 whitespace-pre-wrap',
                      compact ? 'mt-0.5 text-[10px]' : 'mt-0.5 text-xs'
                    )}
                  />

                  <AutoWrappedText
                    text={message.subject}
                    maxLines={compact ? 1 : 2}
                    maxCharacters={maxTextCharacters}
                    className={cn(
                      'max-w-full min-w-0 whitespace-pre-wrap',
                      compact ? 'mt-0.5 text-[12px]' : 'text-sm',
                      message.isRead ? 'text-foreground/80' : 'text-foreground font-semibold'
                    )}
                  />
                  {!compact &&
                    (message.previewHydrated ? (
                      <AutoWrappedText
                        text={message.preview}
                        className="text-muted-foreground mt-0.5 max-w-full min-w-0 text-xs whitespace-pre-wrap"
                      />
                    ) : (
                      <p className="text-muted-foreground/60 mt-0.5 max-w-full min-w-0 text-xs italic">
                        Caricamento anteprima…
                      </p>
                    ))}

                  <div className={cn('mt-2 flex items-center gap-2', compact && 'mt-1.5')}>
                    {!message.isRead && <Badge variant="default">Nuova</Badge>}
                    {message.hasAttachments && !compact && (
                      <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                        <Paperclip className="size-3.5" /> Allegati
                      </span>
                    )}
                  </div>
                </div>
              </Button>
            )
          })}

          {canLoadMoreMessages && (
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={loadingMoreMessages}
                onClick={onLoadMoreMessages}
              >
                {loadingMoreMessages ? (
                  <>
                    <Spinner className="size-4" /> Caricamento...
                  </>
                ) : (
                  `Carica altre ${MESSAGE_LIST_PAGE_SIZE} email`
                )}
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
