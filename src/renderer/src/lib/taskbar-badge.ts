import { useEffect } from 'react'

const BADGE_SIZE = 32

/**
 * The overlay Windows puts on the taskbar button: the count — 99+ past
 * that — in a disc of the theme's alert colour, as a PNG data URL.
 */
function drawBadge(count: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = BADGE_SIZE
  canvas.height = BADGE_SIZE
  const context = canvas.getContext('2d')

  if (!context) {
    return null
  }

  const styles = getComputedStyle(document.documentElement)
  const color = (token: string): string => `hsl(${styles.getPropertyValue(token).trim()})`
  const label = count > 99 ? '99+' : String(count)
  const center = BADGE_SIZE / 2

  context.fillStyle = color('--destructive')
  context.beginPath()
  context.arc(center, center, center, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = color('--destructive-foreground')
  context.font = `700 ${label.length > 2 ? 13 : label.length > 1 ? 17 : 20}px "Segoe UI", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, center, center + 1)

  return canvas.toDataURL('image/png')
}

/**
 * Draws the unread count Windows cannot draw on the taskbar button, each
 * time the main process says it changed (see `AppBadge`).
 */
export function useTaskbarBadge(): void {
  useEffect(
    () =>
      window.mailApi.onTaskbarBadgeChanged((count) => {
        const image = count > 0 ? drawBadge(count) : null
        void window.mailApi.setTaskbarBadgeImage(
          image,
          image ? (count === 1 ? '1 messaggio non letto' : `${count} messaggi non letti`) : ''
        )
      }),
    []
  )
}
