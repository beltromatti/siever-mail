import { defineMessages } from '@shared/i18n'

import { messagesNow } from './i18n'
import { formatCount } from './utils'

const MESSAGES = defineMessages({
  message: { en: 'message', it: 'messaggio', de: 'Nachricht' },
  messages: { en: 'messages', it: 'messaggi', de: 'Nachrichten' }
})

/**
 * Messages dragged from the list onto a folder. The data rides on the drag
 * under a type of the app's own, so nothing else — a file from the desktop,
 * text from another app — reads as messages, and the label under the
 * pointer says how many are going.
 */
export const MESSAGE_DRAG_TYPE = 'application/x-siever-messages'

export function startMessageDrag(dataTransfer: DataTransfer, count: number, payload: string): void {
  dataTransfer.effectAllowed = 'move'
  dataTransfer.setData(MESSAGE_DRAG_TYPE, payload)

  // The browser photographs the element as it is now, so it can go at once.
  const label = document.createElement('div')
  const m = messagesNow(MESSAGES)
  label.textContent = formatCount(count, m.message, m.messages)
  label.style.cssText = [
    'position:fixed',
    'top:-200px',
    'left:-200px',
    'padding:4px 10px',
    'border-radius:9999px',
    'font:600 12px var(--font-sans)',
    'background:hsl(var(--primary))',
    'color:hsl(var(--primary-foreground))'
  ].join(';')
  document.body.appendChild(label)
  dataTransfer.setDragImage(label, 14, 14)
  requestAnimationFrame(() => label.remove())
}

/** Whether a drag carries messages of the list (its data is only readable on drop). */
export function isMessageDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(MESSAGE_DRAG_TYPE)
}
