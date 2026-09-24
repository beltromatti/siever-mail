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
import { cn } from '@renderer/lib/utils'
import type { MailAddress } from '@shared/models'

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
  const first = addresses[0]

  if (!first) {
    return 'nessun destinatario'
  }

  const others = addresses.length - 1
  const name = addressDisplayName(first)

  if (others === 0) {
    return name
  }

  return `${name} e ${others === 1 ? 'un altro' : `altri ${others}`}`
}

function AddressToken({
  address,
  actions
}: {
  address: MailAddress
  actions?: AddressActions
}): React.JSX.Element {
  const name = addressDisplayName(address)
  const showsAddressSeparately = name !== address.address

  const copyAddress = (): void => {
    void navigator.clipboard
      .writeText(address.address)
      .then(() => toast.success('Indirizzo copiato', { description: address.address }))
      .catch(() => toast.error('Copia non riuscita'))
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
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
            Scrivi un messaggio
          </DropdownMenuItem>
        )}
        {actions?.onSearch && (
          <DropdownMenuItem onSelect={() => actions.onSearch?.(address)}>
            <Search className="text-muted-foreground size-3.5" />
            Cerca i suoi messaggi
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={copyAddress}>
          <Copy className="text-muted-foreground size-3.5" />
          Copia indirizzo
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
          e altri {addresses.length - FOLDED_VISIBLE_COUNT}
        </button>
      )}
    </span>
  )
}
