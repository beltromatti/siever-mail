import { ipcMain, shell, type BrowserWindow } from 'electron'

import type { MailService } from '@main/services/mail-service'
import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import { logMainError, sanitizeForLog } from '@main/utils/error-utils'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AddImapAccountInput,
  ActiveMailboxContext,
  ComposeMailInput,
  DownloadAttachmentInput,
  ListMessagesOptions,
  MessageRef,
  MoveMessageInput,
  ToggleSeenInput
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
  registerHandler(IPC_CHANNELS.bootstrap, async () => mailService.bootstrap())

  registerHandler(IPC_CHANNELS.addGoogleAccount, async () => {
    return mailService.addGoogleAccount(getMainWindow() ?? undefined)
  })

  registerHandler(IPC_CHANNELS.addImapAccount, async (payload) => {
    return mailService.addImapAccount(payload as AddImapAccountInput)
  })

  registerHandler(IPC_CHANNELS.markAccountLastViewed, async (accountId: string) => {
    await mailService.markAccountLastViewed(accountId)
  })

  registerHandler(IPC_CHANNELS.removeAccount, async (accountId: string) => {
    await mailService.removeAccount(accountId)
  })

  registerHandler(IPC_CHANNELS.setActiveMailboxContext, async (context) => {
    await mailService.setActiveMailboxContext((context as ActiveMailboxContext | null) ?? null)
  })

  registerHandler(IPC_CHANNELS.listFolders, async (accountId: string) => {
    return mailService.listFolders(accountId)
  })

  registerHandler(IPC_CHANNELS.getUnifiedInboxSummary, async () => {
    return mailService.getUnifiedInboxSummary()
  })

  registerHandler(IPC_CHANNELS.getUnifiedInboxPreferences, async () => {
    return mailService.getUnifiedInboxPreferences()
  })

  registerHandler(IPC_CHANNELS.setUnifiedInboxIncludedAccounts, async (accountIds: string[]) => {
    return mailService.setUnifiedInboxIncludedAccounts(accountIds)
  })

  registerHandler(
    IPC_CHANNELS.listMessages,
    async (accountId: string, folderPath: string, options?: ListMessagesOptions) => {
      return mailService.listMessages(accountId, folderPath, options)
    }
  )

  registerHandler(IPC_CHANNELS.getMessage, async (ref) => {
    return mailService.getMessage(ref as MessageRef)
  })

  registerHandler(IPC_CHANNELS.moveMessage, async (payload) => {
    await mailService.moveMessage(payload as MoveMessageInput)
  })

  registerHandler(IPC_CHANNELS.deleteMessage, async (ref) => {
    await mailService.deleteMessage(ref as MessageRef)
  })

  registerHandler(IPC_CHANNELS.archiveMessage, async (ref) => {
    await mailService.archiveMessage(ref as MessageRef)
  })

  registerHandler(IPC_CHANNELS.toggleSeen, async (payload) => {
    await mailService.toggleSeen(payload as ToggleSeenInput)
  })

  registerHandler(IPC_CHANNELS.sendMail, async (payload) => {
    await mailService.sendMail(payload as ComposeMailInput)
  })

  registerHandler(IPC_CHANNELS.suggestContacts, async (query: string, limit?: number) => {
    return mailService.suggestContacts(query, limit)
  })

  registerHandler(IPC_CHANNELS.listAccountSignatures, async () => {
    return mailService.listAccountSignatures()
  })

  registerHandler(IPC_CHANNELS.getAccountSignature, async (accountId: string) => {
    return mailService.getAccountSignature(accountId)
  })

  registerHandler(IPC_CHANNELS.setAccountSignature, async (accountId: string, html: string) => {
    return mailService.setAccountSignature(accountId, html)
  })

  registerHandler(IPC_CHANNELS.getDataStorageBreakdown, async () => {
    return mailService.getDataStorageBreakdown()
  })

  registerHandler(IPC_CHANNELS.clearAccountData, async (accountId: string) => {
    await mailService.clearAccountData(accountId)
  })

  registerHandler(IPC_CHANNELS.clearAllDataKeepAccounts, async () => {
    await mailService.clearAllDataKeepAccounts()
  })

  registerHandler(IPC_CHANNELS.pickAttachments, async () => {
    return mailService.pickAttachments()
  })

  registerHandler(IPC_CHANNELS.downloadAttachment, async (payload) => {
    return mailService.downloadAttachment(payload as DownloadAttachmentInput)
  })

  registerHandler(IPC_CHANNELS.openExternalUrl, async (rawUrl: string) => {
    const safeExternalUrl = normalizeExternalHttpUrl(rawUrl)
    if (!safeExternalUrl) {
      return false
    }

    await shell.openExternal(safeExternalUrl)
    return true
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
