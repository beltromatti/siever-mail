import { LoaderCircle } from 'lucide-react'

import { MessageList } from '@renderer/features/mail/message-list'
import type { MessageListEmptyState } from '@renderer/features/mail/message-list-empty'
import type { MessageListViewProps } from '@renderer/features/mail/message-list-view'
import { MessageTable } from '@renderer/features/mail/message-table'
import { ProjectBanner } from '@renderer/features/segretario/project-banner'
import { SearchBanner } from '@renderer/features/segretario/search-banner'
import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { formatCount } from '@renderer/lib/utils'
import { folderRoleLabel, segretarioProjectPath } from '@shared/folders'
import { defineMessages } from '@shared/i18n'
import type { Commitment } from '@shared/segretario'

import type { MailApp } from './use-mail-app'

const MESSAGES = defineMessages({
  messageOne: { en: 'message', it: 'messaggio', de: 'Nachricht' },
  messageOther: { en: 'messages', it: 'messaggi', de: 'Nachrichten' },
  unreadOne: { en: 'unread message', it: 'messaggio non letto', de: 'ungelesene Nachricht' },
  unreadOther: { en: 'unread messages', it: 'messaggi non letti', de: 'ungelesene Nachrichten' },
  flaggedOne: { en: 'flagged message', it: 'messaggio contrassegnato', de: 'markierte Nachricht' },
  flaggedOther: {
    en: 'flagged messages',
    it: 'messaggi contrassegnati',
    de: 'markierte Nachrichten'
  },
  activeOne: { en: 'active message', it: 'messaggio attivo', de: 'aktive Nachricht' },
  activeOther: { en: 'active messages', it: 'messaggi attivi', de: 'aktive Nachrichten' },
  resultOne: { en: 'result', it: 'risultato', de: 'Ergebnis' },
  resultOther: { en: 'results', it: 'risultati', de: 'Ergebnisse' },
  searchingText: {
    en: ' · also searching the text…',
    it: ' · cerco anche nel testo…',
    de: ' · durchsuche auch den Text…'
  },
  searchingFor: {
    en: (query: string) => `Searching for “${query}”…`,
    it: (query: string) => `Cerco «${query}»…`,
    de: (query: string) => `Suche nach „${query}“…`
  },
  searchingServer: {
    en: (view: string) =>
      `Nothing among the senders, recipients, subjects and previews of “${view}”: searching the full text of the messages on the server.`,
    it: (view: string) =>
      `Nessun riscontro tra mittenti, destinatari, oggetti e anteprime di «${view}»: sto cercando nel testo completo dei messaggi sul server.`,
    de: (view: string) =>
      `Keine Treffer bei Absendern, Empfängern, Betreffzeilen und Vorschauen in „${view}“: Ich durchsuche den vollständigen Text der Nachrichten auf dem Server.`
  },
  notFound: {
    en: (query: string) => `No messages found for “${query}”`,
    it: (query: string) => `Nessun messaggio trovato per «${query}»`,
    de: (query: string) => `Keine Nachrichten für „${query}“ gefunden`
  },
  /**
   * Where a search that found nothing looked, in so many words — the answer
   * to "is that all, or were there more to load?".
   */
  searched: {
    en: (count: number, total: string, view: string, withServer: boolean) => {
      const where =
        count === 1 ? `the only message in “${view}”` : `all ${total} messages in “${view}”`
      return withServer
        ? `Searched ${where}: sender, recipients, subject and text.`
        : `Searched ${where} downloaded to this computer: searching the text on the server didn’t work.`
    },
    it: (count: number, total: string, view: string, withServer: boolean) => {
      const where =
        count === 1
          ? `nell'unico messaggio di «${view}»`
          : `in tutti i ${total} messaggi di «${view}»`
      return withServer
        ? `Cercato ${where}: mittente, destinatari, oggetto e testo.`
        : `Cercato ${where} scaricati su questo computer: la ricerca nel testo sul server non è riuscita.`
    },
    de: (count: number, total: string, view: string, withServer: boolean) => {
      const where =
        count === 1
          ? `Die einzige Nachricht in „${view}“`
          : `Alle ${total} Nachrichten in „${view}“`
      return withServer
        ? `${where} durchsucht: Absender, Empfänger, Betreff und Text.`
        : `${where} auf diesem Computer durchsucht: Die Suche im Text auf dem Server ist fehlgeschlagen.`
    }
  },
  onlyUnread: {
    en: 'Only among unread messages: the filter at the top is on.',
    it: 'Solo tra i messaggi non letti: il filtro in alto è attivo.',
    de: 'Nur unter ungelesenen Nachrichten: Der Filter oben ist aktiv.'
  },
  onlyFlagged: {
    en: 'Only among flagged messages: the filter at the top is on.',
    it: 'Solo tra i messaggi contrassegnati: il filtro in alto è attivo.',
    de: 'Nur unter markierten Nachrichten: Der Filter oben ist aktiv.'
  },
  onlyActive: {
    en: 'Only among active messages: the filter at the top is on.',
    it: 'Solo tra i messaggi attivi: il filtro in alto è attivo.',
    de: 'Nur unter aktiven Nachrichten: Der Filter oben ist aktiv.'
  },
  notYetSynced: {
    en: (count: number, total: string) =>
      count === 1
        ? 'One message of the folder is still on its way from the server and is not included.'
        : `${total} messages of the folder are still on their way from the server and are not included.`,
    it: (count: number, total: string) =>
      count === 1
        ? 'Un messaggio della cartella è ancora in arrivo dal server e non è compreso.'
        : `${total} messaggi della cartella sono ancora in arrivo dal server e non sono compresi.`,
    de: (count: number, total: string) =>
      count === 1
        ? 'Eine Nachricht des Ordners ist noch unterwegs vom Server und nicht enthalten.'
        : `${total} Nachrichten des Ordners sind noch unterwegs vom Server und nicht enthalten.`
  },
  exitSearch: { en: 'Exit search', it: 'Esci dalla ricerca', de: 'Suche beenden' },
  noneUnread: {
    en: (view: string) => `No unread messages in “${view}”`,
    it: (view: string) => `Nessun messaggio non letto in «${view}»`,
    de: (view: string) => `Keine ungelesene Nachricht in „${view}“`
  },
  noneFlagged: {
    en: (view: string) => `No flagged messages in “${view}”`,
    it: (view: string) => `Nessun messaggio contrassegnato in «${view}»`,
    de: (view: string) => `Keine markierte Nachricht in „${view}“`
  },
  noneActive: {
    en: (view: string) => `No active messages in “${view}”`,
    it: (view: string) => `Nessun messaggio attivo in «${view}»`,
    de: (view: string) => `Keine aktive Nachricht in „${view}“`
  },
  showAll: { en: 'Show all', it: 'Mostra tutti', de: 'Alle anzeigen' },
  noMessagesIn: {
    en: (view: string) => `No messages in “${view}”`,
    it: (view: string) => `Nessun messaggio in «${view}»`,
    de: (view: string) => `Keine Nachrichten in „${view}“`
  }
})

/**
 * The list of the view open, as the layout preference draws it — the rows
 * beside the reading pane, or the table above it — with its search, filter,
 * count and what the Segretario says of a project or a search asked in words.
 */
export function MailMessageList({
  mail,
  segretarioOpen,
  canWrite,
  onRemind,
  onRowActivated
}: {
  mail: MailApp
  /** A message clicked or opened in the list: it comes in front of what is being written. */
  onRowActivated?: () => void
  /** The Segretario's column takes the window's right edge. */
  segretarioOpen: boolean
  /** The Segretario can work: a project's "Where it stands" can be written again. */
  canWrite: boolean
  /** Asks the Segretario, in its panel, for a reminder to whoever is awaited. */
  onRemind: (commitment: Commitment) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { language, formatLocale } = useLanguage()
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
    marks,
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
      ? ([m.unreadOne, m.unreadOther] as const)
      : messageFilter === 'flagged'
        ? ([m.flaggedOne, m.flaggedOther] as const)
        : messageFilter === 'active'
          ? ([m.activeOne, m.activeOther] as const)
          : ([m.messageOne, m.messageOther] as const)
  // What the filter at the top leaves out, said when the list comes out empty.
  const filtered =
    messageFilter === 'unread'
      ? { onlyAmong: m.onlyUnread, none: m.noneUnread }
      : messageFilter === 'flagged'
        ? { onlyAmong: m.onlyFlagged, none: m.noneFlagged }
        : { onlyAmong: m.onlyActive, none: m.noneActive }
  const listCountLabel = activeSearchQuery
    ? formatCount(totalMessagesInFolder, m.resultOne, m.resultOther) +
      (serverSearchStatus === 'searching' ? m.searchingText : '')
    : formatCount(totalMessagesInFolder, filterNouns[0], filterNouns[1])
  const notYetSynced = Math.max(0, listCounts.serverCount - listCounts.cachedCount)
  const listEmptyState: MessageListEmptyState | null = loadingMessages
    ? null
    : activeSearchQuery
      ? serverSearchStatus === 'searching'
        ? {
            kind: 'search',
            title: m.searchingFor(activeSearchQuery),
            lines: [m.searchingServer(currentViewLabel)]
          }
        : {
            kind: 'search',
            title: m.notFound(activeSearchQuery),
            lines: [
              m.searched(
                listCounts.cachedCount,
                listCounts.cachedCount.toLocaleString(formatLocale),
                currentViewLabel,
                serverSearchStatus === 'done'
              ),
              ...(messageFilter !== 'all' ? [filtered.onlyAmong] : []),
              ...(notYetSynced > 0
                ? [m.notYetSynced(notYetSynced, notYetSynced.toLocaleString(formatLocale))]
                : [])
            ],
            action: { label: m.exitSearch, onClick: clearSearch }
          }
      : messageFilter !== 'all'
        ? {
            kind: 'filter',
            title: filtered.none(currentViewLabel),
            lines: [],
            action: { label: m.showAll, onClick: () => setMessageFilter('all') }
          }
        : { kind: 'folder', title: m.noMessagesIn(currentViewLabel), lines: [] }

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
    searchScopeLabel: currentUnifiedRole
      ? folderRoleLabel(currentUnifiedRole, language)
      : currentViewLabel,
    filter: messageFilter,
    onFilterChange: setMessageFilter,
    showActiveFilter: aiOn,
    atWindowTopRight:
      uiPreferences.layoutMode === 'outlook' && !isMessageExpanded && !segretarioOpen,
    messages,
    rowWork,
    marks,
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
    onActivateRow: (ref, intent) => {
      onRowActivated?.()
      handleActivateRow(ref, intent)
    },
    onOpenRow: (ref) => {
      onRowActivated?.()
      handleOpenRow(ref)
    },
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
  // layouts, and a five-column table cannot live there: it kept From, To and
  // a sliver of Subject and dropped the date. The expanded view is meant to
  // be the same screen whichever layout you came from, so it always uses
  // the stacked rows that were designed for a narrow column.
  uiPreferences.layoutMode === 'outlook' && !isMessageExpanded ? (
    <MessageTable {...listViewProps} />
  ) : (
    <MessageList {...listViewProps} />
  )
}
