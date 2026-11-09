import { app, nativeImage, type BrowserWindow } from 'electron'

import { NOTIFICATIONS_IPC, type BadgeShown } from '@shared/notifications'

/**
 * The number on the app's icon (vision §13.3) — what waits for the user
 * today, or the unread mail, as the user chose: the Dock badge on macOS,
 * the launcher's count on Linux. Windows draws no number on a taskbar
 * button, so there the page draws the badge it is told and hands the
 * picture back (`setOverlayImage`), which goes on the button as its
 * overlay, with what it counts in words.
 */
export class AppBadge {
  private wanted: BadgeShown = { count: 0, description: '' }
  /** What the icon shows, null until it is first told. */
  private shown: BadgeShown | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  /** The number to show, with what it counts in words; zero shows none. */
  set(badge: BadgeShown): void {
    this.wanted = badge
    this.apply()
  }

  /** The window loaded anew: on Windows its page draws the badge again. */
  redraw(): void {
    this.shown = null
    this.apply()
  }

  setOverlayImage(dataUrl: string | null, description: string): void {
    this.getWindow()?.setOverlayIcon(
      dataUrl ? nativeImage.createFromDataURL(dataUrl) : null,
      description
    )
  }

  private apply(): void {
    const badge = this.wanted

    if (this.shown?.count === badge.count && this.shown.description === badge.description) {
      return
    }

    this.shown = badge

    if (process.platform === 'win32') {
      this.getWindow()?.webContents.send(NOTIFICATIONS_IPC.badgeChanged, badge)
    } else {
      app.setBadgeCount(badge.count)
    }
  }
}
