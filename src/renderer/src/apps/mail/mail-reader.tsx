import { Fragment } from 'react'

import extensionRenderer from '@app/extension/renderer'
import { InvitationCard } from '@renderer/features/calendar/invitation-card'
import { ComposerSlot } from '@renderer/features/mail/composer-layer'
import { ComposerTabs, type ComposerTab } from '@renderer/features/mail/composer-tabs'
import { MessageMarksLine } from '@renderer/features/mail/message-marks'
import { MessageViewer } from '@renderer/features/mail/message-viewer'
import { PecPanel } from '@renderer/features/mail/pec-panel'
import { MessageWorkPanel } from '@renderer/features/segretario/message-work'
import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { summaryToMessageRef } from '@renderer/lib/message-selection'
import { cn } from '@renderer/lib/utils'
import { isIcsAttachment } from '@shared/calendar'
import { segretarioProjectPath } from '@shared/folders'
import { defineMessages } from '@shared/i18n'
import type { Commitment } from '@shared/segretario'

import type { MailApp } from './use-mail-app'

const MESSAGES = defineMessages({
  selected: {
    en: (count: string) => `${count} selected`,
    it: (count: string) => `${count} selezionati`,
    de: (count: string) => `${count} ausgewählt`
  }
})

/** The messages being written, as the reading pane holds them: a tab each. */
export interface ReaderWriting {
  tabs: ReadonlyArray<ComposerTab>
  /** The one in front; null for the message being read. */
  activeId: string | null
  onSelect: (id: string | null) => void
  onClose: (id: string) => void
  onNew: () => void
}

/**
 * The reading pane: the message in sight with what goes with it — an
 * invitation, the Segretario's work on it, the extension's actions — or,
 * over a selection of several, what can be done with them all. While
 * something is being written it has tabs (vision §6.6): the message read,
 * and each message being written, which takes the pane when in front.
 */
export function MailReader({
  mail,
  segretarioOpen,
  onRemind,
  onTakeUpReply,
  writing
}: {
  mail: MailApp
  /** The Segretario's column takes the window's right edge. */
  segretarioOpen: boolean
  /** Asks the Segretario, in its panel, for a reminder to whoever is awaited. */
  onRemind: (commitment: Commitment) => void
  /** A reply the Segretario prepared, taken up in a composer. */
  onTakeUpReply: (accountId: string, messageKey: string, text: string) => Promise<void>
  writing: ReaderWriting
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { formatLocale } = useLanguage()
  const {
    accounts,
    aiOn,
    uiPreferences,
    updateUiPreferences,
    changeReaderZoom,
    projects,
    selectFolder,
    messages,
    selection,
    clearSelection,
    hasMoreMessages,
    totalMessagesInFolder,
    messageForViewer,
    readingRef,
    readerBodyStatus,
    loadMessageDetail,
    isMessageExpanded,
    setIsMessageExpanded,
    selectingWholeView,
    selectWholeView,
    moveFolders,
    moveExcludedPath,
    recentMovePaths,
    selectionAccountIds,
    explainMixedAccountMove,
    moveMenuOpen,
    changeMoveMenuOpen,
    toggleSeenLabel,
    selectionFlagged,
    archiveSelection,
    moveSelectionTo,
    createFolderAndMoveSelection,
    setSelectionSeen,
    setSelectionFlagged,
    deleteMessages,
    openReplyComposer,
    openForwardComposer,
    isDraftMessage,
    continueDraft,
    attachmentActions,
    addressActions,
    extensionSelection,
    extensionHostHooks,
    setExtensionPrimaryDialogOpen,
    openMessage,
    viewerMarks
  } = mail

  // The pane's first band is the window's title bar where the pane meets its top right corner.
  const atWindowTopRight =
    !segretarioOpen && (isMessageExpanded || uiPreferences.layoutMode === 'apple')
  const tabsShown = writing.tabs.length > 0
  const readingLabel =
    selection.selectedRefs.length > 1
      ? m.selected(selection.selectedRefs.length.toLocaleString(formatLocale))
      : messageForViewer?.subject || null

  const viewer = (
    <MessageViewer
      message={messageForViewer}
      brief={
        messageForViewer &&
        selection.selectedRefs.length === 1 && (
          <>
            <PecPanel message={messageForViewer} onOpen={openMessage} />
            {messageForViewer.attachments.some(isIcsAttachment) && (
              <InvitationCard
                key={`${messageForViewer.accountId}:${messageForViewer.folderPath}:${messageForViewer.uid}`}
                messageRef={summaryToMessageRef(messageForViewer)}
              />
            )}
            <MessageMarksLine marks={viewerMarks} />
            {aiOn && (
              <MessageWorkPanel
                key={`${messageForViewer.accountId}:${messageForViewer.messageKey}`}
                accountId={messageForViewer.accountId}
                messageKey={messageForViewer.messageKey}
                threadId={messageForViewer.threadId}
                projects={projects}
                onOpenProject={(projectId) => selectFolder(segretarioProjectPath(projectId))}
                accountEmail={(accountId) =>
                  accounts.find((account) => account.id === accountId)?.email
                }
                onTakeUpReply={onTakeUpReply}
                onRemind={onRemind}
                onActOnProposal={(proposal) => {
                  const action = extensionRenderer.proposalActions?.[proposal.kind]

                  if (action) {
                    extensionRenderer.runCommand?.(action.commandId, {
                      selection: extensionSelection,
                      openPrimaryActionDialog: () => setExtensionPrimaryDialogOpen(true),
                      hostHooks: extensionHostHooks
                    })
                  }
                }}
              />
            )}
          </>
        )
      }
      bodyStatus={readerBodyStatus}
      onRetryBody={() => {
        if (readingRef) {
          void loadMessageDetail(readingRef)
        }
      }}
      isExpanded={isMessageExpanded}
      selectedCount={selection.selectedRefs.length}
      onClearSelection={clearSelection}
      wholeViewSelection={
        hasMoreMessages &&
        selection.selectedRefs.length > 1 &&
        selection.selectedRefs.length === messages.length
          ? {
              total: totalMessagesInFolder,
              selecting: selectingWholeView,
              onSelect: () => void selectWholeView()
            }
          : undefined
      }
      atWindowTopRight={atWindowTopRight && !tabsShown}
      extensionActions={
        selection.selectedRefs.length > 0 &&
        extensionRenderer.toolbarActions.map((action) => (
          <Fragment key={action.id}>
            {action.render({
              selection: extensionSelection,
              openPrimaryActionDialog: () => setExtensionPrimaryDialogOpen(true),
              hostHooks: extensionHostHooks
            })}
          </Fragment>
        ))
      }
      selectionActions={{
        moveFolders,
        moveExcludedPath,
        recentMovePaths,
        onMoveAcrossAccounts:
          selectionAccountIds.length > 1 ? () => void explainMixedAccountMove() : undefined,
        moveMenuOpen,
        onMoveMenuOpenChange: changeMoveMenuOpen,
        toggleSeenLabel,
        selectionFlagged,
        onArchive: () => void archiveSelection(),
        onMoveToFolder: (destinationFolderPath) => void moveSelectionTo(destinationFolderPath),
        onCreateFolderAndMove: (name) => void createFolderAndMoveSelection(name),
        onToggleSeen: () => void setSelectionSeen(),
        onToggleFlagged: () => void setSelectionFlagged(),
        onDelete: () => void deleteMessages(selection.selectedRefs)
      }}
      onReply={() => void openReplyComposer('sender')}
      onReplyAll={() => void openReplyComposer('all')}
      onForward={() => void openForwardComposer()}
      onContinueDraft={
        readingRef && messageForViewer && isDraftMessage(messageForViewer)
          ? () => void continueDraft(readingRef)
          : undefined
      }
      onToggleExpanded={() => {
        if (!readingRef) {
          return
        }

        setIsMessageExpanded((current) => !current)
      }}
      attachmentActions={attachmentActions}
      zoom={uiPreferences.readerZoom}
      onZoomChange={changeReaderZoom}
      detailsOpen={uiPreferences.readerDetailsOpen}
      onDetailsOpenChange={(readerDetailsOpen) => updateUiPreferences({ readerDetailsOpen })}
      addressActions={addressActions}
    />
  )

  // One tree whatever is in front: the message read stays mounted under a message being
  // written — its frame, where it was scrolled to — as each message being written stays in its own.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabsShown && (
        <ComposerTabs
          readingLabel={readingLabel}
          tabs={writing.tabs}
          activeId={writing.activeId}
          atWindowTopRight={atWindowTopRight}
          onSelect={writing.onSelect}
          onClose={writing.onClose}
          onNew={writing.onNew}
        />
      )}
      <div className={cn('min-h-0 flex-1', writing.activeId && 'hidden')}>{viewer}</div>
      {writing.activeId && <ComposerSlot />}
    </div>
  )
}
