import { LoaderCircle, PenLine } from 'lucide-react'

import { ActionTooltip } from '@renderer/components/ui/action-tooltip'
import { Button } from '@renderer/components/ui/button'
import { AccountSwitcher } from '@renderer/features/accounts/account-switcher'
import { FolderSidebar } from '@renderer/features/mail/folder-sidebar'
import { SEGRETARIO_VIEWS } from '@shared/folders'

import type { MailApp } from './use-mail-app'

/** The mail's column: "Scrivi", the account, its folders, the Segretario's views and projects. */
export function MailSidebar({
  mail,
  showTitle,
  onAddAccount
}: {
  mail: MailApp
  /** The app's name in the title band, where the window draws none of its own there. */
  showTitle: boolean
  /** "Aggiungi una connessione": the guided setup, the shell's. */
  onAddAccount: () => void
}): React.JSX.Element {
  const {
    accounts,
    aiOn,
    openComposer,
    selectedAccountId,
    removingAccountId,
    selectAccount,
    removeAccount,
    loadingFolders,
    segretarioViewCounts,
    projects,
    createProject,
    savedSearches,
    folders,
    unifiedSummaries,
    selectedFolderPath,
    messageDrop,
    selectFolder,
    openFolderContextMenu
  } = mail
  const selectedAccountRecord = accounts.find((account) => account.id === selectedAccountId)
  const selectedAccountLabel =
    selectedAccountRecord?.displayName || selectedAccountRecord?.email || 'Cartelle'

  return (
    <>
      <div className="window-drag-region flex h-[52px] shrink-0 items-center gap-2 pr-3 pl-[max(12px,calc(var(--titlebar-lights)-52px))]">
        {showTitle ? <span className="display-title text-[13.5px]">SIEVER Mail</span> : null}
        <div className="flex-1" />
        <ActionTooltip label="Nuovo messaggio" commandId="compose">
          <Button
            size="sm"
            className="window-no-drag"
            disabled={!selectedAccountId}
            onClick={() => {
              if (selectedAccountId) {
                openComposer({ kind: 'new', accountId: selectedAccountId })
              }
            }}
          >
            <PenLine className="size-3.5" />
            Scrivi
          </Button>
        </ActionTooltip>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <AccountSwitcher
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          removingAccountId={removingAccountId}
          onSelectAccount={selectAccount}
          onRemoveAccount={(accountId) => void removeAccount(accountId)}
          onAddAccount={onAddAccount}
        />
      </div>
      <div className="min-h-0 flex-1">
        {loadingFolders ? (
          <div className="text-faint-foreground flex items-center gap-2 px-4 py-3 text-[12px]">
            <LoaderCircle className="size-3.5 animate-spin" /> Caricamento cartelle…
          </div>
        ) : (
          <FolderSidebar
            segretarioViews={
              aiOn && segretarioViewCounts
                ? SEGRETARIO_VIEWS.map((view) => ({
                    view,
                    count: segretarioViewCounts[view]
                  }))
                : []
            }
            projects={aiOn ? projects : null}
            onCreateProject={(title) => void createProject(title)}
            savedSearches={aiOn ? savedSearches : []}
            accountLabel={selectedAccountLabel}
            folders={folders}
            unifiedFolders={accounts.length > 1 ? unifiedSummaries : []}
            selectedFolderPath={selectedFolderPath}
            messageDrop={messageDrop}
            onSelectFolder={selectFolder}
            onFolderContextMenu={(target) => void openFolderContextMenu(target)}
          />
        )}
      </div>
    </>
  )
}
