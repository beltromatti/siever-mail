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
          variant="ghost"
          className="border-border/60 bg-card/50 hover:bg-card/80 h-9 w-full justify-between gap-2 rounded-md border px-2.5 text-left"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary/15 text-primary flex size-5 shrink-0 items-center justify-center rounded">
              <Mail className="size-3" />
            </span>
            <span className="min-w-0">
              <span className="text-foreground block truncate text-[12px] font-semibold">
                {selectedAccount ? selectedAccount.displayName : 'Nessun account'}
              </span>
              {selectedAccount && (
                <span className="text-muted-foreground block truncate text-[10px] leading-tight font-normal">
                  {selectedAccount.email}
                </span>
              )}
            </span>
          </div>
          <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-[320px]">
        <DropdownMenuLabel>Account collegati</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            className={cn(
              'cursor-pointer items-start gap-2 rounded-md px-2 py-1.5',
              selectedAccountId === account.id && 'bg-secondary/65'
            )}
            onClick={() => onSelectAccount(account.id)}
          >
            <div className="bg-primary/15 text-primary mt-0.5 rounded p-1">
              <Mail className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{account.displayName}</p>
              <p className="text-muted-foreground truncate text-[10.5px]">{account.email}</p>
            </div>
            {onRemoveAccount && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive focus-visible:ring-ring ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={`Disconnetti account ${account.email}`}
                    disabled={Boolean(removingAccountId)}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
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
              <Plus className="text-primary size-4" />
              Aggiungi Account
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
