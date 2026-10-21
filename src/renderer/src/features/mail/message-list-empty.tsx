import { Inbox, SearchX } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'

/**
 * What an empty list says, in so many words: a search that found nothing
 * says where it looked and through how many messages, so "nothing" reads as
 * the answer rather than as a page not loaded yet.
 */
export interface MessageListEmptyState {
  kind: 'search' | 'filter' | 'folder'
  title: string
  lines: string[]
  action?: { label: string; onClick: () => void }
}

export function MessageListEmpty({ state }: { state: MessageListEmptyState }): React.JSX.Element {
  const Icon = state.kind === 'folder' ? Inbox : SearchX

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
      <div className="bg-secondary/65 text-muted-foreground rounded-full p-2.5">
        <Icon className="size-5" />
      </div>
      <p className="text-foreground max-w-xs text-[13px] font-semibold break-words">
        {state.title}
      </p>
      {state.lines.map((line) => (
        <p key={line} className="text-muted-foreground max-w-xs text-[11.5px] leading-relaxed">
          {line}
        </p>
      ))}
      {state.action && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-1 h-7 px-2.5 text-[11.5px]"
          onClick={state.action.onClick}
        >
          {state.action.label}
        </Button>
      )}
    </div>
  )
}
