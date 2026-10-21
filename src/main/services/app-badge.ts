import { app, nativeImage, type BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '@shared/ipc'

/**
 * The unread count of Posta in arrivo on the app's icon, as Apple Mail and
 * Outlook show it: the Dock badge on macOS, the launcher's count on Linux.
 * Windows draws no count on a taskbar button, so there the page draws the
 * badge for the count it is told and hands the picture back
 * (`setOverlayImage`), which goes on the button as its overlay.
 */
export class AppBadge {
  private count = 0
  private enabled = true
  /** What the icon shows, null until it is first told. */
  private shown: number | null = null

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.apply()
  }

  setCount(count: number): void {
    this.count = count
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
    const count = this.enabled ? this.count : 0

    if (count === this.shown) {
      return
    }

    this.shown = count

    if (process.platform === 'win32') {
      this.getWindow()?.webContents.send(IPC_CHANNELS.taskbarBadgeChanged, count)
    } else {
      app.setBadgeCount(count)
    }
  }
}
