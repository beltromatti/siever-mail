/**
 * People in a message header, one token each.
 *
 * The reading header used to print every recipient as one comma-joined line.
 * With a real distribution list that line was thousands of pixels long: it
 * could only be read by expanding "Dettagli", and in the outlook layout it
 * even stretched the workspace past the window. Tokens wrap onto as many
 * lines as the list needs, show the name people recognise, keep the address
 * one hover away, and give each person the actions a mail client offers on a
 * name — write to them, copy the address, find their other messages.
 */
import { useState } from 'react'
import { Copy, MailPlus, Search } from 'lucide-react'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { MailAddress } from '@shared/models'

const MESSAGES = defineMessages({
  noRecipient: { en: 'no recipient', it: 'nessun destinatario', de: 'kein Empfänger' },
  andOthers: {
    en: (name: string, others: number) =>
      `${name} and ${others === 1 ? '1 other' : `${others} others`}`,
    it: (name: string, others: number) =>
      `${name} e ${others === 1 ? 'un altro' : `altri ${others}`}`,
    de: (name: string, others: number) => `${name} und ${others} weitere`
  },
  copied: { en: 'Address copied', it: 'Indirizzo copiato', de: 'Adresse kopiert' },
  copyFailed: { en: 'Couldn’t copy', it: 'Copia non riuscita', de: 'Kopieren fehlgeschlagen' },
  compose: { en: 'Write a message', it: 'Scrivi un messaggio', de: 'Nachricht verfassen' },
  search: {
    en: 'Find their messages',
    it: 'Cerca i suoi messaggi',
    de: 'Nachrichten dieser Person suchen'
  },
  copyAddress: { en: 'Copy address', it: 'Copia indirizzo', de: 'Adresse kopieren' },
  more: {
    en: (count: number) => `and ${count} more`,
    it: (count: number) => `e altri ${count}`,
    de: (count: number) => `und ${count} weitere`
  }
})

export interface AddressActions {
  onCompose?: (address: MailAddress) => void
  onSearch?: (address: MailAddress) => void
}

/** Past this many people the list folds, so a mass mailing stays a glance. */
const FOLD_THRESHOLD = 24
const FOLDED_VISIBLE_COUNT = 16

export function addressDisplayName(address: MailAddress): string {
  return address.name?.trim() || address.address
}

/**
 * One line for the collapsed header: the first person and how many others.
 * The count is what matters at a glance; the names are one click away.
 */
export function summarizeAddresses(addresses: ReadonlyArray<MailAddress>): string {
  const m = messagesNow(MESSAGES)
  const first = addresses[0]

  if (!first) {
    return m.noRecipient
  }

  const others = addresses.length - 1
  const name = addressDisplayName(first)

  if (others === 0) {
    return name
  }

  return m.andOthers(name, others)
}

function AddressToken({
  address,
  actions
}: {
  address: MailAddress
  actions?: AddressActions
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const name = addressDisplayName(address)
  const showsAddressSeparately = name !== address.address

  const copyAddress = (): void => {
    void navigator.clipboard
      .writeText(address.address)
      .then(() => toast.success(m.copied, { description: address.address }))
      .catch(() => toast.error(m.copyFailed))
  }

  // The same actions on a right click, as a native menu.
  const showNativeMenu = async (): Promise<void> => {
    const chosen = await window.mailApi.showContextMenu([
      ...(actions?.onCompose ? [{ id: 'compose', label: m.compose }] : []),
      ...(actions?.onSearch ? [{ id: 'search', label: m.search }] : []),
      { type: 'separator' },
      { id: 'copy', label: m.copyAddress }
    ])

    if (chosen === 'compose') {
      actions?.onCompose?.(address)
    } else if (chosen === 'search') {
      actions?.onSearch?.(address)
    } else if (chosen === 'copy') {
      copyAddress()
    }
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onContextMenu={(event) => {
                event.preventDefault()
                void showNativeMenu()
              }}
              className="bg-secondary/55 hover:bg-secondary text-foreground focus-visible:ring-ring/70 data-[state=open]:bg-secondary inline-flex h-5 max-w-full items-center rounded px-1.5 text-[11px] leading-none outline-none focus-visible:ring-2"
            >
              <span className="truncate">{name}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {showsAddressSeparately && <TooltipContent side="top">{address.address}</TooltipContent>}
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate">{name}</span>
          {showsAddressSeparately && (
            <span className="text-muted-foreground truncate text-[11px] font-normal">
              {address.address}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions?.onCompose && (
          <DropdownMenuItem onSelect={() => actions.onCompose?.(address)}>
            <MailPlus className="text-muted-foreground size-3.5" />
            {m.compose}
          </DropdownMenuItem>
        )}
        {actions?.onSearch && (
          <DropdownMenuItem onSelect={() => actions.onSearch?.(address)}>
            <Search className="text-muted-foreground size-3.5" />
            {m.search}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={copyAddress}>
          <Copy className="text-muted-foreground size-3.5" />
          {m.copyAddress}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AddressTokens({
  addresses,
  actions,
  className
}: {
  addresses: ReadonlyArray<MailAddress>
  actions?: AddressActions
  className?: string
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [expanded, setExpanded] = useState(false)
  const folds = addresses.length > FOLD_THRESHOLD && !expanded
  const visible = folds ? addresses.slice(0, FOLDED_VISIBLE_COUNT) : addresses

  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {visible.map((address, index) => (
        <AddressToken key={`${address.address}-${index}`} address={address} actions={actions} />
      ))}
      {folds && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-primary hover:text-primary/80 focus-visible:ring-ring/70 h-5 rounded px-1 text-[11px] font-medium outline-none focus-visible:ring-2"
        >
          {m.more(addresses.length - FOLDED_VISIBLE_COUNT)}
        </button>
      )}
    </span>
  )
}
