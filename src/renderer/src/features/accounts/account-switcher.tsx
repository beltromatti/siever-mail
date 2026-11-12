import { useState } from 'react'
import { ChevronDown, LoaderCircle, LogOut, Plus } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { ProviderLogo } from '@renderer/components/ui/provider-logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { accessOfMail } from '@renderer/features/connections/connection-groups'
import { useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { MailAccount } from '@shared/models'

const MESSAGES = defineMessages({
  noAccount: { en: 'No account', it: 'Nessun account', de: 'Kein Konto' },
  connected: { en: 'Connected accounts', it: 'Account collegati', de: 'Verbundene Konten' },
  disconnectAccount: {
    en: (email: string) => `Disconnect account ${email}`,
    it: (email: string) => `Disconnetti account ${email}`,
    de: (email: string) => `Konto ${email} trennen`
  },
  disconnect: { en: 'Disconnect account', it: 'Disconnetti account', de: 'Konto trennen' },
  add: { en: 'Add account', it: 'Aggiungi account', de: 'Konto hinzufügen' }
})

interface AccountSwitcherProps {
  accounts: MailAccount[]
  selectedAccountId: string | null
  onSelectAccount: (accountId: string) => void
  onRemoveAccount?: (accountId: string) => void
  removingAccountId?: string | null
  onAddAccount?: () => void
}

/**
 * A mailbox's mark: its provider's, on a tile — a square reads as a
 * mailbox, a circle as a person. The tile holds the place empty when no
 * mailbox is chosen.
 */
function AccountMark({ account }: { account: MailAccount | null }): React.JSX.Element {
  return account ? (
    <span className="bg-page grid size-[24px] shrink-0 place-items-center rounded-[6px] border">
      <ProviderLogo provider={accessOfMail(account)} named className="size-[15px]" />
    </span>
  ) : (
    <span aria-hidden className="size-[24px] shrink-0 rounded-[6px] border border-dashed" />
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
  const m = useMessages(MESSAGES)
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
            <AccountMark account={selectedAccount} />
            <span className="min-w-0">
              <span className="text-foreground block truncate text-[12.5px] font-semibold">
                {selectedAccount ? selectedAccount.displayName : m.noAccount}
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
        <DropdownMenuLabel>{m.connected}</DropdownMenuLabel>
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
            <AccountMark account={account} />
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
                    aria-label={m.disconnectAccount(account.email)}
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
                <TooltipContent side="right">{m.disconnect}</TooltipContent>
              </Tooltip>
            )}
          </DropdownMenuItem>
        ))}

        {onAddAccount && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2 px-3 py-2" onClick={onAddAccount}>
              <Plus className="size-4" />
              {m.add}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
