import { handleIpc } from '@main/ipc/handle'
import type { Workspace } from '@main/workspace'
import { NOTIFICATIONS_IPC } from '@shared/notifications'

/** The notifications' channels (vision §13.3): their preferences, what the system does with them. */
export function registerNotificationsIpc(workspace: Workspace): void {
  handleIpc('app', NOTIFICATIONS_IPC.getPreferences, () => workspace.getNotificationPreferences())
  handleIpc('app', NOTIFICATIONS_IPC.setPreferences, (preferences: unknown) =>
    workspace.setNotificationPreferences(preferences)
  )
  handleIpc('app', NOTIFICATIONS_IPC.getStatus, () => workspace.notificationStatus())
  // It waits for the system to show it, or to say it will not.
  handleIpc('app', NOTIFICATIONS_IPC.showTest, () => workspace.showTestNotification(), {
    untimed: true
  })
  handleIpc('app', NOTIFICATIONS_IPC.openSystemSettings, () => workspace.openNotificationSettings())
  handleIpc('app', NOTIFICATIONS_IPC.setBadgeImage, (dataUrl: unknown, description: unknown) =>
    workspace.setTaskbarBadgeImage(dataUrl, description)
  )
}
