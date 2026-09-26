import { app, ipcMain, shell, type BrowserWindow } from 'electron'

import type { MailService } from '@main/services/mail-service'
import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import { logMainError, sanitizeForLog } from '@main/utils/error-utils'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AddImapAccountInput,
  ActiveMailboxContext,
  AttachmentRef,
  ComposeMailInput,
  ListMessagesOptions,
  MessageAttachmentsRef,
  MessageRef,
  MoveMessageInput,
  ToggleFlaggedInput,
  ToggleSeenInput,
  UiPreferences
} from '@shared/models'

function registerHandler<Args extends unknown[], ReturnValue>(
  channel: string,
  handler: (...args: Args) => Promise<ReturnValue>
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (_event, ...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      logMainError(`IPC handler failed: ${channel}`, error, {
        channel,
        args: sanitizeForLog(args)
      })
      throw error
    }
  })
}

export function registerMailIpc(
  mailService: MailService,
  getMainWindow: () => BrowserWindow | null
): void {
  // Channels that read or change stored data wait for the storage to be
  // open and any upgrade migration to be done (see `MailService.openStorage`).
  // Those that only drive the window or the shell, at the bottom, never
  // wait: the window must stay movable and closable during a long upgrade.
  const registerDataHandler = <Args extends unknown[], ReturnValue>(
    channel: string,
    handler: (...args: Args) => Promise<ReturnValue>
  ): void => {
    registerHandler(channel, async (...args: Args) => {
      await mailService.openStorage()
      return handler(...args)
    })
  }

  registerDataHandler(IPC_CHANNELS.bootstrap, async () => mailService.bootstrap())

  registerDataHandler(IPC_CHANNELS.getAccountConnectionStates, async () =>
    mailService.getAccountConnectionStates()
  )

  registerDataHandler(IPC_CHANNELS.getUiPreferences, async () => mailService.getUiPreferences())

  registerDataHandler(IPC_CHANNELS.setUiPreferences, async (preferences) =>
    mailService.setUiPreferences(preferences as UiPreferences)
  )

  registerDataHandler(IPC_CHANNELS.addGoogleAccount, async () => {
    return mailService.addGoogleAccount(getMainWindow() ?? undefined)
  })

  registerDataHandler(IPC_CHANNELS.addImapAccount, async (payload) => {
    return mailService.addImapAccount(payload as AddImapAccountInput)
  })

  registerDataHandler(IPC_CHANNELS.markAccountLastViewed, async (accountId: string) => {
    await mailService.markAccountLastViewed(accountId)
  })

  registerDataHandler(IPC_CHANNELS.removeAccount, async (accountId: string) => {
    await mailService.removeAccount(accountId)
  })

  registerDataHandler(IPC_CHANNELS.setActiveMailboxContext, async (context) => {
    await mailService.setActiveMailboxContext((context as ActiveMailboxContext | null) ?? null)
  })

  registerDataHandler(IPC_CHANNELS.listFolders, async (accountId: string) => {
    return mailService.listFolders(accountId)
  })

  registerDataHandler(IPC_CHANNELS.getUnifiedInboxSummary, async () => {
    return mailService.getUnifiedInboxSummary()
  })

  registerDataHandler(IPC_CHANNELS.getUnifiedInboxPreferences, async () => {
    return mailService.getUnifiedInboxPreferences()
  })

  registerDataHandler(
    IPC_CHANNELS.setUnifiedInboxIncludedAccounts,
    async (accountIds: string[]) => {
      return mailService.setUnifiedInboxIncludedAccounts(accountIds)
    }
  )

  registerHandler(
    IPC_CHANNELS.listMessages,
    async (accountId: string, folderPath: string, options?: ListMessagesOptions) => {
      return mailService.listMessages(accountId, folderPath, options)
    }
  )

  registerDataHandler(IPC_CHANNELS.getMessage, async (ref) => {
    return mailService.getMessage(ref as MessageRef)
  })

  registerDataHandler(IPC_CHANNELS.moveMessage, async (payload) => {
    await mailService.moveMessage(payload as MoveMessageInput)
  })

  registerDataHandler(IPC_CHANNELS.deleteMessage, async (ref) => {
    await mailService.deleteMessage(ref as MessageRef)
  })

  registerDataHandler(IPC_CHANNELS.archiveMessage, async (ref) => {
    await mailService.archiveMessage(ref as MessageRef)
  })

  registerDataHandler(IPC_CHANNELS.toggleSeen, async (payload) => {
    await mailService.toggleSeen(payload as ToggleSeenInput)
  })

  registerDataHandler(IPC_CHANNELS.toggleFlagged, async (payload) => {
    await mailService.toggleFlagged(payload as ToggleFlaggedInput)
  })

  registerDataHandler(IPC_CHANNELS.sendMail, async (payload) => {
    await mailService.sendMail(payload as ComposeMailInput)
  })

  registerDataHandler(IPC_CHANNELS.suggestContacts, async (query: string, limit?: number) => {
    return mailService.suggestContacts(query, limit)
  })

  registerDataHandler(IPC_CHANNELS.listAccountSignatures, async () => {
    return mailService.listAccountSignatures()
  })

  registerDataHandler(IPC_CHANNELS.getAccountSignature, async (accountId: string) => {
    return mailService.getAccountSignature(accountId)
  })

  registerDataHandler(IPC_CHANNELS.setAccountSignature, async (accountId: string, html: string) => {
    return mailService.setAccountSignature(accountId, html)
  })

  registerDataHandler(IPC_CHANNELS.getDataStorageBreakdown, async () => {
    return mailService.getDataStorageBreakdown()
  })

  registerDataHandler(IPC_CHANNELS.clearAccountData, async (accountId: string) => {
    await mailService.clearAccountData(accountId)
  })

  registerDataHandler(IPC_CHANNELS.clearAllDataKeepAccounts, async () => {
    await mailService.clearAllDataKeepAccounts()
  })

  registerDataHandler(IPC_CHANNELS.pickAttachments, async () => {
    return mailService.pickAttachments(getMainWindow() ?? undefined)
  })

  registerDataHandler(IPC_CHANNELS.openAttachment, async (payload) => {
    return mailService.openAttachment(payload as AttachmentRef)
  })

  registerDataHandler(IPC_CHANNELS.saveAttachment, async (payload) => {
    return mailService.saveAttachment(payload as AttachmentRef, getMainWindow() ?? undefined)
  })

  registerDataHandler(IPC_CHANNELS.saveAllAttachments, async (ref) => {
    return mailService.saveAllAttachments(ref as MessageRef, getMainWindow() ?? undefined)
  })

  registerDataHandler(IPC_CHANNELS.copyMessageAttachments, async (payload) => {
    return mailService.copyMessageAttachments(payload as MessageAttachmentsRef)
  })

  registerDataHandler(IPC_CHANNELS.clearAttachmentCache, async () => {
    await mailService.clearAttachmentCache()
  })

  registerDataHandler(IPC_CHANNELS.revealFile, async (filePath: string) => {
    mailService.revealFile(filePath)
  })

  registerDataHandler(IPC_CHANNELS.listRecentFiles, async () => mailService.listRecentFiles())

  registerDataHandler(IPC_CHANNELS.describeFiles, async (paths: string[]) => {
    return mailService.describeFiles(paths)
  })

  registerHandler(IPC_CHANNELS.openExternalUrl, async (rawUrl: string) => {
    const safeExternalUrl = normalizeExternalHttpUrl(rawUrl)
    if (!safeExternalUrl) {
      return false
    }

    await shell.openExternal(safeExternalUrl)
    return true
  })

  registerHandler(IPC_CHANNELS.openLogsFolder, async () => {
    const failure = await shell.openPath(app.getPath('logs'))

    if (failure) {
      throw new Error(failure)
    }
  })

  registerHandler(IPC_CHANNELS.getWindowControlsState, async () => {
    const window = getMainWindow()
    const isWindows = process.platform === 'win32'

    return {
      enabled: isWindows,
      maximized: Boolean(window && !window.isDestroyed() && window.isMaximized()),
      dragTopRegionEnabled: isWindows || process.platform === 'darwin'
    }
  })

  registerHandler(IPC_CHANNELS.minimizeWindow, async () => {
    const window = getMainWindow()

    if (!window || window.isDestroyed()) {
      return
    }

    window.minimize()
  })

  registerHandler(IPC_CHANNELS.toggleMaximizeWindow, async () => {
    const window = getMainWindow()
    const isWindows = process.platform === 'win32'
    const dragTopRegionEnabled = isWindows || process.platform === 'darwin'

    if (!window || window.isDestroyed()) {
      return {
        enabled: isWindows,
        maximized: false,
        dragTopRegionEnabled
      }
    }

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }

    return {
      enabled: isWindows,
      maximized: window.isMaximized(),
      dragTopRegionEnabled
    }
  })

  registerHandler(IPC_CHANNELS.closeWindow, async () => {
    const window = getMainWindow()

    if (!window || window.isDestroyed()) {
      return
    }

    window.close()
  })
}
