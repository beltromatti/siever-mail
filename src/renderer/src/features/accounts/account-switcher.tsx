import { ChevronDown, LoaderCircle, LogOut, Mail, Plus } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
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

export function AccountSwitcher({
  accounts,
  selectedAccountId,
  onSelectAccount,
  onRemoveAccount,
  removingAccountId,
  onAddAccount
}: AccountSwitcherProps): React.JSX.Element {
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) || null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="border-border/70 bg-card/70 hover:bg-card h-12 w-full justify-between rounded-lg px-4 text-left"
        >
          <div className="min-w-0">
            <p className="text-muted-foreground truncate text-xs tracking-[0.14em] uppercase">
              Account
            </p>
            <p className="text-foreground truncate text-sm font-semibold">
              {selectedAccount ? selectedAccount.displayName : 'Nessun account'}
            </p>
          </div>
          <ChevronDown className="text-muted-foreground size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[320px]">
        <DropdownMenuLabel>Account collegati</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            className={cn(
              'cursor-pointer items-start gap-3 rounded-md px-3 py-2',
              selectedAccountId === account.id && 'bg-secondary/65'
            )}
            onClick={() => onSelectAccount(account.id)}
          >
            <div className="bg-primary/15 text-primary mt-0.5 rounded-md p-1.5">
              <Mail className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{account.displayName}</p>
              <p className="text-muted-foreground truncate text-xs">{account.email}</p>
            </div>
            {onRemoveAccount && (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive focus-visible:ring-ring ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                title="Disconnetti account"
                aria-label={`Disconnetti account ${account.email}`}
                disabled={Boolean(removingAccountId)}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRemoveAccount(account.id)
                }}
              >
                {removingAccountId === account.id ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
              </button>
            )}
          </DropdownMenuItem>
        ))}

        {onAddAccount && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2 px-3 py-2" onClick={onAddAccount}>
              <Plus className="text-primary size-4" />
              Aggiungi Account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
