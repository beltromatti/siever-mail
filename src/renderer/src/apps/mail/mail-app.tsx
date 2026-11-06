/**
 * The Posta, one of the workspace's apps. Its state and what it does live in
 * `useMailApp`, which the shell calls so the mail keeps its place while
 * another app is in front; its panes fill the workspace's columns
 * (`MailSidebar`, `MailMessageList`, `MailReader`), and what it puts on
 * screen besides them is here: the notice above them, its dialogs.
 */
import { AlertTriangle, X } from 'lucide-react'

import extensionRenderer from '@app/extension/renderer'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { FolderPicker } from '@renderer/features/mail/folder-picker'

import type { MailApp } from './use-mail-app'

/** What went wrong in the mail, above the panes — and above another app, wherever the user went. */
export function MailNotice({ mail }: { mail: MailApp }): React.JSX.Element | null {
  const { viewError, setViewError } = mail

  return viewError ? (
    <div className="bg-destructive/10 text-destructive-soft-foreground flex shrink-0 items-center gap-2 border-b px-4 py-2 text-[12px]">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{viewError}</span>
      <button
        type="button"
        onClick={() => setViewError(null)}
        aria-label="Chiudi avviso"
        className="hover:text-foreground shrink-0"
      >
        <X className="size-3.5" />
      </button>
    </div>
  ) : null
}

/**
 * The mail's dialogs, mounted whichever app is in front: its commands reach
 * them from anywhere — "Vai a una cartella", the extension's action.
 */
export function MailDialogs({ mail }: { mail: MailApp }): React.JSX.Element {
  const {
    promptDialog,
    goToFolderOpen,
    setGoToFolderOpen,
    folders,
    selectedFolderPath,
    selectFolder,
    extensionPrimaryDialogOpen,
    setExtensionPrimaryDialogOpen,
    extensionSelection,
    extensionHostHooks
  } = mail

  return (
    <>
      {promptDialog}
      <Dialog open={goToFolderOpen} onOpenChange={setGoToFolderOpen}>
        <DialogContent hideClose className="w-auto gap-0 p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Vai a una cartella</DialogTitle>
          <FolderPicker
            folders={folders}
            recentPaths={[]}
            excludedPath={selectedFolderPath}
            onPick={(folderPath) => {
              setGoToFolderOpen(false)
              selectFolder(folderPath)
            }}
          />
        </DialogContent>
      </Dialog>

      {extensionRenderer.PrimaryActionDialog && (
        <extensionRenderer.PrimaryActionDialog
          open={extensionPrimaryDialogOpen}
          onOpenChange={setExtensionPrimaryDialogOpen}
          selection={extensionSelection}
          hostHooks={extensionHostHooks}
        />
      )}
    </>
  )
}
