import { LoaderCircle } from 'lucide-react'

import { MessageList } from '@renderer/features/mail/message-list'
import type { MessageListEmptyState } from '@renderer/features/mail/message-list-empty'
import type { MessageListViewProps } from '@renderer/features/mail/message-list-view'
import { MessageTable } from '@renderer/features/mail/message-table'
import { ProjectBanner } from '@renderer/features/segretario/project-banner'
import { SearchBanner } from '@renderer/features/segretario/search-banner'
import { formatCount } from '@renderer/lib/utils'
import { folderRoleLabel, segretarioProjectPath } from '@shared/folders'
import type { Commitment } from '@shared/segretario'

import type { MailApp } from './use-mail-app'

/**
 * Where a search that found nothing looked, in so many words — the answer
 * to "is that all, or were there more to load?".
 */
function searchedScopeLine(count: number, viewLabel: string, withServer: boolean): string {
  const where =
    count === 1
      ? `nell'unico messaggio di «${viewLabel}»`
      : `in tutti i ${count.toLocaleString('it-IT')} messaggi di «${viewLabel}»`

  return withServer
    ? `Cercato ${where}: mittente, destinatari, oggetto e testo.`
    : `Cercato ${where} scaricati su questo computer: la ricerca nel testo sul server non è riuscita.`
}

/**
 * The list of the view open, as the layout preference draws it — the rows
 * beside the reading pane, or the table above it — with its search, filter,
 * count and what the Segretario says of a project or a search asked in words.
 */
export function MailMessageList({
  mail,
  segretarioOpen,
  canWrite,
  onRemind
}: {
  mail: MailApp
  /** The Segretario's column takes the window's right edge. */
  segretarioOpen: boolean
  /** The Segretario can work: a project's "Il punto" can be written again. */
  canWrite: boolean
  /** Asks the Segretario, in its panel, for a reminder to whoever is awaited. */
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element {
  const {
    aiOn,
    uiPreferences,
    isMessageExpanded,
    showMessagePanelLoader,
    messagePanelLoaderText,
    currentViewLabel,
    currentUnifiedRole,
    currentProjectId,
    currentSearchId,
    currentSaved,
    currentAsked,
    projects,
    selectFolder,
    conversationProjectTags,
    askingSegretario,
    askSegretario,
    stopAskingSegretario,
    saveSearch,
    removeSavedSearch,
    search,
    setSearch,
    clearSearch,
    searchInputRef,
    activeSearchQuery,
    serverSearchStatus,
    messageFilter,
    setMessageFilter,
    messages,
    rowWork,
    messageSections,
    totalMessagesInFolder,
    listCounts,
    loadingMessages,
    selection,
    highlightTerms,
    handleMessageListSortChange,
    handleMessageGroupingChange,
    primaryAddressMode,
    accountLabels,
    hasMoreMessages,
    loadingMoreMessages,
    loadMoreMessagesHandler,
    revealCursorToken,
    hydratePreviewsInView,
    handleActivateRow,
    handleOpenRow,
    openMessageContextMenu,
    handleRowDragStart,
    setDraggedRefs,
    handleToggleRowFlag,
    handleSelectSection,
    handleSelectAll,
    clearSelection
  } = mail
  const filterNouns =
    messageFilter === 'unread'
      ? (['messaggio non letto', 'messaggi non letti'] as const)
      : messageFilter === 'flagged'
        ? (['messaggio contrassegnato', 'messaggi contrassegnati'] as const)
        : messageFilter === 'active'
          ? (['messaggio attivo', 'messaggi attivi'] as const)
          : (['messaggio', 'messaggi'] as const)
  const listCountLabel = activeSearchQuery
    ? formatCount(totalMessagesInFolder, 'risultato', 'risultati') +
      (serverSearchStatus === 'searching' ? ' · cerco anche nel testo…' : '')
    : formatCount(totalMessagesInFolder, filterNouns[0], filterNouns[1])
  const notYetSynced = Math.max(0, listCounts.serverCount - listCounts.cachedCount)
  const listEmptyState: MessageListEmptyState | null = loadingMessages
    ? null
    : activeSearchQuery
      ? serverSearchStatus === 'searching'
        ? {
            kind: 'search',
            title: `Cerco «${activeSearchQuery}»…`,
            lines: [
              `Nessun riscontro tra mittenti, destinatari, oggetti e anteprime di «${currentViewLabel}»: sto cercando nel testo completo dei messaggi sul server.`
            ]
          }
        : {
            kind: 'search',
            title: `Nessun messaggio trovato per «${activeSearchQuery}»`,
            lines: [
              searchedScopeLine(
                listCounts.cachedCount,
                currentViewLabel,
                serverSearchStatus === 'done'
              ),
              ...(messageFilter !== 'all'
                ? [`Solo tra i ${filterNouns[1]}: il filtro in alto è attivo.`]
                : []),
              ...(notYetSynced > 0
                ? [
                    notYetSynced === 1
                      ? 'Un messaggio della cartella è ancora in arrivo dal server e non è compreso.'
                      : `${notYetSynced.toLocaleString('it-IT')} messaggi della cartella sono ancora in arrivo dal server e non sono compresi.`
                  ]
                : [])
            ],
            action: { label: 'Esci dalla ricerca', onClick: clearSearch }
          }
      : messageFilter !== 'all'
        ? {
            kind: 'filter',
            title: `Nessun ${filterNouns[0]} in «${currentViewLabel}»`,
            lines: [],
            action: { label: 'Mostra tutti', onClick: () => setMessageFilter('all') }
          }
        : { kind: 'folder', title: `Nessun messaggio in «${currentViewLabel}»`, lines: [] }

  const listViewProps: MessageListViewProps = {
    title: currentViewLabel,
    projectTags: currentProjectId || !aiOn ? null : conversationProjectTags,
    askSegretario: aiOn
      ? { busy: askingSegretario, onAsk: askSegretario, onStop: stopAskingSegretario }
      : undefined,
    banner:
      currentProjectId && aiOn ? (
        <ProjectBanner
          key={currentProjectId}
          projectId={currentProjectId}
          projects={projects}
          canWrite={canWrite}
          onRemind={onRemind}
          onMerged={(keptId) => selectFolder(segretarioProjectPath(keptId))}
        />
      ) : currentSearchId && currentAsked ? (
        <SearchBanner
          key={currentSearchId}
          question={currentAsked.question}
          saved={currentSaved !== undefined}
          onSave={() => saveSearch(currentSearchId)}
          onRemove={() => removeSavedSearch(currentSearchId)}
        />
      ) : undefined,
    searchQuery: search.trim(),
    onClearSearch: clearSearch,
    search,
    onSearchChange: setSearch,
    searchInputRef,
    searchScopeLabel: currentUnifiedRole ? folderRoleLabel(currentUnifiedRole) : currentViewLabel,
    filter: messageFilter,
    onFilterChange: setMessageFilter,
    showActiveFilter: aiOn,
    atWindowTopRight:
      uiPreferences.layoutMode === 'outlook' && !isMessageExpanded && !segretarioOpen,
    messages,
    rowWork,
    sections: messageSections,
    countLabel: currentAsked ? `${listCountLabel} · ${currentAsked.how}` : listCountLabel,
    emptyState: listEmptyState,
    selection,
    highlightTerms,
    sort: uiPreferences.messageListSort,
    onSortChange: handleMessageListSortChange,
    grouping: uiPreferences.messageGrouping,
    onGroupingChange: handleMessageGroupingChange,
    invertVisualOrder: uiPreferences.invertMessageListOrder,
    primaryAddressMode,
    accountLabels,
    canLoadMoreMessages: hasMoreMessages,
    loadingMoreMessages,
    onLoadMoreMessages: loadMoreMessagesHandler,
    revealCursorToken,
    onRowsInView: hydratePreviewsInView,
    onActivateRow: handleActivateRow,
    onOpenRow: handleOpenRow,
    onRowContextMenu: (ref) => void openMessageContextMenu(ref),
    onRowDragStart: handleRowDragStart,
    onRowDragEnd: () => setDraggedRefs(null),
    onToggleFlag: handleToggleRowFlag,
    onSelectSection: handleSelectSection,
    onSelectAll: handleSelectAll,
    onClearSelection: clearSelection
  }

  return showMessagePanelLoader ? (
    <div className="glass-panel flex h-full flex-col items-center justify-center gap-2.5 rounded-lg">
      <LoaderCircle className="text-primary size-5 animate-spin" />
      <p className="text-muted-foreground text-xs">{messagePanelLoaderText}</p>
    </div>
  ) : // The expanded reader turns the list into a 260-360px spine in both
  // layouts, and a five-column table cannot live there: it kept Da, A and
  // a sliver of Oggetto and dropped the date. The expanded view is meant to
  // be the same screen whichever layout you came from, so it always uses
  // the stacked rows that were designed for a narrow column.
  uiPreferences.layoutMode === 'outlook' && !isMessageExpanded ? (
    <MessageTable {...listViewProps} />
  ) : (
    <MessageList {...listViewProps} />
  )
}
