import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'

import { popupPageContextMenu } from '@main/context-menu'
import type { MailService } from '@main/services/mail-service'
import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import { logMainError, sanitizeForLog } from '@main/utils/error-utils'
import type { ContextMenuItem } from '@shared/context-menu'
import { IPC_CHANNELS } from '@shared/ipc'
import type {
  AddImapAccountInput,
  ActiveMailboxContext,
  AttachmentRef,
  ComposeMailInput,
  CreateFolderInput,
  DraftContent,
  ListMessagesOptions,
  MessageAttachmentsRef,
  MessageRef,
  MoveMessagesInput,
  MoveMessagesToRoleInput,
  NotificationPreferences,
  RenameFolderInput,
  SetMessagesKeywordInput,
  UiPreferences
} from '@shared/models'

/** What a rejected input has wrong, each thing once: "«x@y.i» non è un indirizzo email valido." */
function validationMessage(error: z.ZodError): string {
  return [...new Set(error.issues.map((issue) => issue.message))].slice(0, 3).join(' ')
}

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
      // Input turned down says what is wrong with it, not its issues as JSON.
      throw error instanceof z.ZodError ? new Error(validationMessage(error)) : error
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

  registerDataHandler(IPC_CHANNELS.checkMailNow, async () => {
    mailService.checkMailNow()
  })

  registerDataHandler(IPC_CHANNELS.setActiveMailboxContext, async (context) => {
    await mailService.setActiveMailboxContext((context as ActiveMailboxContext | null) ?? null)
  })

  registerDataHandler(IPC_CHANNELS.listFolders, async (accountId: string) => {
    return mailService.listFolders(accountId)
  })

  registerDataHandler(IPC_CHANNELS.listRecentFolders, async (accountId: string) =>
    mailService.listRecentFolders(accountId)
  )

  registerDataHandler(IPC_CHANNELS.createFolder, async (input) =>
    mailService.createFolder(input as CreateFolderInput)
  )

  registerDataHandler(IPC_CHANNELS.renameFolder, async (input) =>
    mailService.renameFolder(input as RenameFolderInput)
  )

  registerDataHandler(IPC_CHANNELS.markFolderRead, async (accountId: string, folderPath: string) =>
    mailService.markFolderRead(accountId, folderPath)
  )

  registerDataHandler(IPC_CHANNELS.getUnifiedFolderSummaries, async () => {
    return mailService.getUnifiedFolderSummaries()
  })

  registerDataHandler(IPC_CHANNELS.getNotificationPreferences, async () =>
    mailService.getNotificationPreferences()
  )

  registerDataHandler(IPC_CHANNELS.setNotificationPreferences, async (preferences) =>
    mailService.setNotificationPreferences(preferences as NotificationPreferences)
  )

  registerHandler(IPC_CHANNELS.getNotificationStatus, async () =>
    mailService.getNotificationStatus()
  )

  registerHandler(IPC_CHANNELS.showTestNotification, async () => mailService.showTestNotification())

  registerHandler(IPC_CHANNELS.openNotificationSettings, async () =>
    mailService.openNotificationSettings()
  )

  registerHandler(
    IPC_CHANNELS.setTaskbarBadgeImage,
    async (dataUrl: string | null, description: string) =>
      mailService.setTaskbarBadgeImage(dataUrl, description)
  )

  registerDataHandler(IPC_CHANNELS.getUnifiedPreferences, async () => {
    return mailService.getUnifiedPreferences()
  })

  registerDataHandler(IPC_CHANNELS.setUnifiedIncludedAccounts, async (accountIds: string[]) => {
    return mailService.setUnifiedIncludedAccounts(accountIds)
  })

  registerHandler(
    IPC_CHANNELS.listMessages,
    async (accountId: string, folderPath: string, options?: ListMessagesOptions) => {
      return mailService.listMessages(accountId, folderPath, options)
    }
  )

  registerDataHandler(IPC_CHANNELS.getMessage, async (ref) => {
    return mailService.getMessage(ref as MessageRef)
  })

  registerDataHandler(IPC_CHANNELS.readMessage, async (ref) => {
    return mailService.readMessage(ref as MessageRef)
  })

  registerDataHandler(IPC_CHANNELS.prefetchMessages, async (refs) => {
    await mailService.prefetchMessages(refs as MessageRef[])
  })

  registerDataHandler(IPC_CHANNELS.hydratePreviews, async (refs) => {
    await mailService.hydratePreviews(refs as MessageRef[])
  })

  registerDataHandler(
    IPC_CHANNELS.searchOnServer,
    async (accountId: string, folderPath: string, query: string) =>
      mailService.searchOnServer(accountId, folderPath, query)
  )

  registerDataHandler(IPC_CHANNELS.moveMessages, async (payload) =>
    mailService.moveMessages(payload as MoveMessagesInput)
  )

  registerDataHandler(IPC_CHANNELS.moveMessagesToRole, async (input) =>
    mailService.moveMessagesToRole(input as MoveMessagesToRoleInput)
  )

  registerDataHandler(IPC_CHANNELS.deleteMessages, async (refs) =>
    mailService.deleteMessages(refs as MessageRef[])
  )

  registerDataHandler(IPC_CHANNELS.archiveMessages, async (refs) =>
    mailService.archiveMessages(refs as MessageRef[])
  )

  registerDataHandler(IPC_CHANNELS.setMessagesSeen, async (payload) =>
    mailService.setMessagesSeen(payload as SetMessagesKeywordInput)
  )

  registerDataHandler(IPC_CHANNELS.setMessagesFlagged, async (payload) =>
    mailService.setMessagesFlagged(payload as SetMessagesKeywordInput)
  )

  registerDataHandler(IPC_CHANNELS.sendMail, async (payload) => {
    await mailService.sendMail(payload as ComposeMailInput)
  })

  registerDataHandler(IPC_CHANNELS.suggestContacts, async (query: string, limit?: number) => {
    return mailService.suggestContacts(query, limit)
  })

  registerDataHandler(IPC_CHANNELS.forgetContact, async (address: string) =>
    mailService.forgetContact(address)
  )

  registerDataHandler(IPC_CHANNELS.saveDraft, async (content) =>
    mailService.saveDraft(content as DraftContent)
  )

  registerDataHandler(IPC_CHANNELS.flushDraft, async (id: string) => mailService.flushDraft(id))

  registerDataHandler(IPC_CHANNELS.closeDraft, async (id: string) => mailService.closeDraft(id))

  registerDataHandler(IPC_CHANNELS.discardDraft, async (id: string) => mailService.discardDraft(id))

  registerDataHandler(IPC_CHANNELS.listDockedDrafts, async () => mailService.listDockedDrafts())

  registerDataHandler(IPC_CHANNELS.openDraftMessage, async (ref) =>
    mailService.openDraftMessage(ref as MessageRef)
  )

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

  registerDataHandler(IPC_CHANNELS.openFile, async (filePath: string) =>
    mailService.openFile(filePath)
  )

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

  registerHandler(IPC_CHANNELS.showContextMenu, async (items: ContextMenuItem[]) => {
    const window = getMainWindow()

    if (!window || window.isDestroyed() || !Array.isArray(items)) {
      return null
    }

    return popupPageContextMenu(window, items)
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
