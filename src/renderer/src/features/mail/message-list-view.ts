import type { MessageSection } from '@renderer/lib/message-sections'
import type { MessageSelectionState, SelectionIntent } from '@renderer/lib/message-selection'
import type {
  MailMessageListSort,
  MailMessageSummary,
  MessageGroupingMode,
  MessageListFilter,
  MessageRef
} from '@shared/models'
import type { MessageMark } from '@shared/message-marks'

import type { MessageRowWork } from '@shared/segretario'

import type { MessageListEmptyState } from './message-list-empty'
import type { MessageHighlightTerms, PrimaryAddressMode } from './message-list-shared'

/**
 * Contract both list shells implement. Keeping it in one place is what lets
 * `MailMessageList` swap the "apple" rows for the "outlook" table without knowing
 * anything about either — the layout preference picks a component, the props
 * stay identical.
 */
export interface MessageListViewProps {
  title: string
  /**
   * Each conversation's projects as a tag, by account and thread (see
   * `threadKey`); null where it would say nothing, as in a project's own list.
   */
  projectTags: ReadonlyMap<string, string> | null
  /** Under the header, above the rows: what the Segretario says of a project's list. */
  banner?: React.ReactNode
  /**
   * Hands what is typed in the search to the Segretario, to search as it
   * means (⌘↵); absent without the Segretario. Busy while it searches.
   */
  askSegretario?: { onAsk: (question: string) => void; onStop: () => void; busy: boolean }
  /** The active search, trimmed; empty when there is none. */
  searchQuery: string
  onClearSearch: () => void
  /** What is typed in the search field, as typed. */
  search: string
  onSearchChange: (value: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  /** Where a search looks: the folder open, or a folder of Tutti gli account. */
  searchScopeLabel: string
  filter: MessageListFilter
  onFilterChange: (next: MessageListFilter) => void
  /** The Segretario is on: the filter offers "Attivi". */
  showActiveFilter: boolean
  /**
   * The list is the pane in the window's top right corner (the outlook
   * layout): on Windows its header keeps clear of the window's buttons.
   */
  atWindowTopRight: boolean
  messages: MailMessageSummary[]
  /** What the Segretario has on these messages, by account and message key (see `rowWorkKey`). */
  rowWork: ReadonlyMap<string, MessageRowWork>
  /** What extensions marked on these messages, the newest first, by account and message key (see `markKey`). */
  marks: ReadonlyMap<string, MessageMark[]>
  sections: MessageSection[]
  /** What the list holds, said under its title: "9.796 messaggi", "12 risultati". */
  countLabel: string
  /** What the list says when it holds nothing; null while it is still loading. */
  emptyState: MessageListEmptyState | null
  selection: MessageSelectionState
  highlightTerms: MessageHighlightTerms
  sort: MailMessageListSort
  onSortChange: (next: MailMessageListSort) => void
  grouping: MessageGroupingMode
  onGroupingChange: (next: MessageGroupingMode) => void
  /**
   * Mirrors the rendered order so the newest row sits at the visual bottom.
   * A presentation flip only — the query order is untouched.
   */
  invertVisualOrder: boolean
  /** Sent and Drafts are about the recipient, not the sender. */
  primaryAddressMode: PrimaryAddressMode
  /**
   * In Tutti gli account, the account each message came to, by account id; `null`
   * when the view holds one account's mail.
   */
  accountLabels: ReadonlyMap<string, string> | null
  /** Whether the cache holds more rows than are loaded: the next page loads as the end nears. */
  canLoadMoreMessages: boolean
  loadingMoreMessages: boolean
  onLoadMoreMessages: () => void
  /** Changes when the list should bring the selection into view (see `VirtualMessageRows`). */
  revealCursorToken: number
  /** The messages whose rows are on screen, once a scroll settles. */
  onRowsInView: (messages: MailMessageSummary[]) => void
  onActivateRow: (ref: MessageRef, intent: SelectionIntent) => void
  onOpenRow: (ref: MessageRef) => void
  /** A right click on a row: the menu of what can be done with it. */
  onRowContextMenu: (ref: MessageRef) => void
  /** A row starts being dragged — with the selection it is part of — towards a folder. */
  onRowDragStart: (ref: MessageRef, dataTransfer: DataTransfer) => void
  onRowDragEnd: () => void
  onToggleFlag: (ref: MessageRef, flagged: boolean) => void
  onSelectSection: (section: MessageSection) => void
  onSelectAll: () => void
  onClearSelection: () => void
}
