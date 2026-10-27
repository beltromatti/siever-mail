import { useState } from 'react'
import { ChevronDown, LoaderCircle, LogOut, Plus } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
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
import type { MailAccount } from '@shared/models'

interface AccountSwitcherProps {
  accounts: MailAccount[]
  selectedAccountId: string | null
  onSelectAccount: (accountId: string) => void
  onRemoveAccount?: (accountId: string) => void
  removingAccountId?: string | null
  onAddAccount?: () => void
}

/**
 * An account's mark: the first letter of its name, in ink on paper. One
 * letter in a square reads as a mailbox; two in a circle read as a person.
 */
function AccountMonogram({ account }: { account: MailAccount | null }): React.JSX.Element {
  const letter = (account?.displayName || account?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <span
      aria-hidden
      className="bg-foreground text-background grid size-[24px] shrink-0 place-items-center rounded-[6px] text-[12px] font-bold"
    >
      {letter}
    </span>
  )
}

export function AccountSwitcher({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onRemoveAccount,
  removingAccountId,
  onAddAccount
}: AccountSwitcherProps): React.JSX.Element {
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="hover:bg-hover h-10 w-full justify-between gap-2 rounded-md px-2 text-left"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <AccountMonogram account={selectedAccount} />
            <span className="min-w-0">
              <span className="text-foreground block truncate text-[12.5px] font-semibold">
                {selectedAccount ? selectedAccount.displayName : 'Nessun account'}
              </span>
              {selectedAccount && (
                <span className="text-faint-foreground block truncate text-[11px] leading-tight font-normal">
                  {selectedAccount.email}
                </span>
              )}
            </span>
          </div>
          <ChevronDown className="text-faint-foreground size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[320px]">
        <DropdownMenuLabel>Account collegati</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            className={cn(
              'cursor-pointer items-center gap-2.5 px-2 py-1.5',
              selectedAccountId === account.id && 'bg-selected'
            )}
            onClick={() => onSelectAccount(account.id)}
          >
            <AccountMonogram account={account} />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold">{account.displayName}</p>
              <p className="text-faint-foreground truncate text-[11px]">{account.email}</p>
            </div>
            {onRemoveAccount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-faint-foreground hover:text-destructive focus-visible:ring-ring ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={`Disconnetti account ${account.email}`}
                    disabled={Boolean(removingAccountId)}
                    onClick={(event) => {
                      // Not a pick of the account: the row must not select it.
                      event.preventDefault()
                      event.stopPropagation()
                      // Disconnecting asks first, and the question replaces the menu.
                      setMenuOpen(false)
                      onRemoveAccount(account.id)
                    }}
                  >
                    {removingAccountId === account.id ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <LogOut className="size-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Disconnetti account</TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuItem>
        ))}

        {onAddAccount && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2 px-3 py-2" onClick={onAddAccount}>
              <Plus className="size-4" />
              Aggiungi account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
