import type { MessageSection } from '@renderer/lib/message-sections'
import type { MessageSelectionState, SelectionIntent } from '@renderer/lib/message-selection'
import type {
  MailMessageListSort,
  MailMessageSummary,
  MessageGroupingMode,
  MessageRef
} from '@shared/models'

import type { MessageHighlightTerms, PrimaryAddressMode } from './message-list-shared'

/**
 * Contract both list shells implement. Keeping it in one place is what lets
 * `App` swap the "apple" rows for the "outlook" table without knowing
 * anything about either — the layout preference picks a component, the props
 * stay identical.
 */
export interface MessageListViewProps {
  title: string
  messages: MailMessageSummary[]
  sections: MessageSection[]
  totalCount: number
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
  canLoadMoreMessages: boolean
  loadingMoreMessages: boolean
  onLoadMoreMessages: () => void
  onActivateRow: (ref: MessageRef, intent: SelectionIntent) => void
  onOpenRow: (ref: MessageRef) => void
  onToggleFlag: (ref: MessageRef, flagged: boolean) => void
  onSelectSection: (section: MessageSection) => void
  onSelectAll: () => void
  onClearSelection: () => void
}
