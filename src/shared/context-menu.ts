/**
 * A context menu the page composes — for a message, an attachment, a
 * person — and the main process shows as a native one. The page gets back
 * the id of the item chosen, or null when the menu was dismissed.
 */
export type ContextMenuItem =
  | {
      id: string
      label: string
      enabled?: boolean
      /** A radio or check mark next to the label. */
      checked?: boolean
      /** The chord that does the same, shown on the right (see `shared/shortcuts.ts`). */
      chord?: string
      submenu?: ContextMenuItem[]
    }
  | { type: 'separator' }

/**
 * What a text, link or image menu the main process built asks the page to
 * do, beyond what it can do itself.
 */
export type ContextMenuRequest =
  { kind: 'search'; text: string } | { kind: 'compose'; address: string }
