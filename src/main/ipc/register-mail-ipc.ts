import { app, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'

import { popupPageContextMenu } from '@main/context-menu'
import { normalizeExternalHttpUrl } from '@main/utils/external-url'
import { diagnostics } from '@main/diagnostics/log'
import { handleIpc, type HandleOptions } from '@main/ipc/handle'
import { beginUninstall, uninstallOffer } from '@main/uninstall'
import type { Workspace } from '@main/workspace'
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
  RenameFolderInput,
  SetMessagesKeywordInput,
  OpenAtLogin,
  UiPreferences
} from '@shared/models'

const log = diagnostics('mail')

/**
 * Whether SIEVER Mail opens as the user signs in: the system's login items,
 * which macOS and Windows let an app set. Only the installed app: from
 * development it would be Electron that opened.
 */
function openAtLogin(): OpenAtLogin {
  const supported =
    app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')

  if (!supported) {
    return { supported, enabled: false, needsApproval: false }
  }

  const settings = app.getLoginItemSettings()
  // macOS may hold a login item until the user allows it in its own settings.
  return {
    supported,
    enabled: settings.openAtLogin,
    needsApproval: settings.status === 'requires-approval'
  }
}

/** A channel of the shell: the window, the storage, the sign-ins. */
function registerHandler<Args extends unknown[], ReturnValue>(
  channel: string,
  handler: (...args: Args) => Promise<ReturnValue>,
  options?: HandleOptions
): void {
  handleIpc('app', channel, handler, options)
}

/**
 * The mail's channels, and those of the app as a whole the page reaches
 * through `window.mailApi`: the storage, the sign-ins with Google and
 * Microsoft, "Elimina tutti i dati", the window.
 */
export function registerMailIpc(
  workspace: Workspace,
  getMainWindow: () => BrowserWindow | null
): void {
  const mailService = workspace.mail
  // Channels that read or change stored data wait for the storage to be
  // open and any upgrade migration to be done (see `Workspace.openStorage`).
  // Those that only drive the window or the shell, at the bottom, never
  // wait: the window must stay movable and closable during a long upgrade.
  const registerDataHandler = <Args extends unknown[], ReturnValue>(
    channel: string,
    handler: (...args: Args) => Promise<ReturnValue>,
    options?: Pick<HandleOptions, 'untimed'>
  ): void => {
    handleIpc('mail', channel, handler, { ...options, before: () => workspace.openStorage() })
  }
  // What waits for the user — a sign-in, a dialog — is never written down as slow.
  const forUser = { untimed: true }
  // What the user does to messages, once done (§14.4): how many, never which.
  const acted = async <T>(ev: string, input: unknown, work: () => Promise<T>): Promise<T> => {
    const result = await work()
    const refs = (input as { refs?: unknown } | null)?.refs
    log.info(ev, { count: Array.isArray(refs) ? refs.length : 0, by: 'user' })
    return result
  }

  registerDataHandler(IPC_CHANNELS.bootstrap, async () => mailService.bootstrap())

  registerDataHandler(IPC_CHANNELS.getAccountConnectionStates, async () =>
    mailService.getAccountConnectionStates()
  )

  registerDataHandler(IPC_CHANNELS.getUiPreferences, async () => mailService.getUiPreferences())

  registerDataHandler(IPC_CHANNELS.setUiPreferences, async (preferences) =>
    mailService.setUiPreferences(preferences as UiPreferences)
  )

  registerDataHandler(IPC_CHANNELS.getOpenAtLogin, async () => openAtLogin())

  registerDataHandler(IPC_CHANNELS.setOpenAtLogin, async (enabled) => {
    if (openAtLogin().supported) {
      app.setLoginItemSettings({ openAtLogin: enabled === true })
      diagnostics('app').info('settings.open-at-login', { enabled: enabled === true })
    }

    return openAtLogin()
  })

  registerDataHandler(
    IPC_CHANNELS.addGoogleAccount,
    async (options) => {
      return workspace.addGoogleAccount(
        getMainWindow() ?? undefined,
        z.object({ calendar: z.boolean() }).strict().parse(options)
      )
    },
    forUser
  )

  registerDataHandler(
    IPC_CHANNELS.addMicrosoftAccount,
    async (options) => {
      return workspace.addMicrosoftAccount(
        z.object({ calendar: z.boolean() }).strict().parse(options)
      )
    },
    forUser
  )

  registerHandler(IPC_CHANNELS.cancelSignIn, async () => workspace.cancelSignIn())

  registerDataHandler(IPC_CHANNELS.discoverMailSettings, async (address) => {
    return mailService.discoverMailSettings(z.string().trim().email().max(320).parse(address))
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

  registerDataHandler(IPC_CHANNELS.outgoingCount, async (accountId: string) =>
    mailService.outgoingCount(accountId)
  )

  registerDataHandler(IPC_CHANNELS.checkMailNow, async () => {
    mailService.checkMailNow()
  })

  registerDataHandler(IPC_CHANNELS.takeBackOutgoing, async (draftId) =>
    mailService.takeBackOutgoing(z.string().uuid().parse(draftId))
  )

  registerDataHandler(IPC_CHANNELS.listConnectionRefusals, async () =>
    workspace.connectionRefusals()
  )

  registerDataHandler(
    IPC_CHANNELS.reconnectAccount,
    async (accountId, password) =>
      workspace.reconnectMailAccount(
        z.string().min(1).parse(accountId),
        z.string().min(1, 'Scrivi la password.').max(1000).optional().parse(password)
      ),
    forUser
  )

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

  registerDataHandler(IPC_CHANNELS.getSegretarioViewCounts, async () => {
    return mailService.getSegretarioViewCounts()
  })
  registerDataHandler(IPC_CHANNELS.getUnifiedFolderSummaries, async () => {
    return mailService.getUnifiedFolderSummaries()
  })

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
    acted('messages.moved', payload, () => mailService.moveMessages(payload as MoveMessagesInput))
  )

  registerDataHandler(IPC_CHANNELS.moveMessagesToRole, async (input) =>
    acted('messages.moved', input, () =>
      mailService.moveMessagesToRole(input as MoveMessagesToRoleInput)
    )
  )

  registerDataHandler(IPC_CHANNELS.deleteMessages, async (refs) =>
    acted('messages.deleted', { refs }, () => mailService.deleteMessages(refs as MessageRef[]))
  )

  registerDataHandler(IPC_CHANNELS.archiveMessages, async (refs) =>
    acted('messages.archived', { refs }, () => mailService.archiveMessages(refs as MessageRef[]))
  )

  registerDataHandler(IPC_CHANNELS.setMessagesSeen, async (payload) =>
    mailService.setMessagesSeen(payload as SetMessagesKeywordInput)
  )

  registerDataHandler(IPC_CHANNELS.setMessagesFlagged, async (payload) =>
    acted('messages.flagged', payload, () =>
      mailService.setMessagesFlagged(payload as SetMessagesKeywordInput)
    )
  )

  registerDataHandler(IPC_CHANNELS.sendMail, async (payload) =>
    mailService.sendMail(payload as ComposeMailInput)
  )

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
  registerDataHandler(IPC_CHANNELS.getStoredDraft, async (id: string) =>
    mailService.getStoredDraft(id)
  )

  registerDataHandler(IPC_CHANNELS.openDraftMessage, async (ref) =>
    mailService.openDraftMessage(ref as MessageRef)
  )

  registerDataHandler(IPC_CHANNELS.listAccountSignatures, async () => {
    return mailService.listAccountSignatures()
  })

  registerDataHandler(IPC_CHANNELS.getAccountSignature, async (accountId: string) => {
    return mailService.getAccountSignature(accountId)
  })

  registerDataHandler(
    IPC_CHANNELS.setAccountSignature,
    async (accountId: string, content: { html: string; headerHtml: string }) =>
      mailService.setAccountSignature(accountId, content)
  )

  registerDataHandler(IPC_CHANNELS.getDataStorageBreakdown, async () => workspace.dataStorage())

  registerDataHandler(IPC_CHANNELS.clearAccountData, async (accountId: string) => {
    await mailService.clearAccountData(accountId)
  })

  registerDataHandler(IPC_CHANNELS.clearAllDataKeepAccounts, async () => {
    await workspace.clearAllDataKeepAccounts()
  })

  registerDataHandler(IPC_CHANNELS.uninstallOffer, async () => uninstallOffer())

  // Taking SIEVER Mail away (§13.2): the clearing starts, and the app quits for it — as it always
  // quits, finishing what it was writing.
  registerDataHandler(IPC_CHANNELS.uninstall, async (keep: unknown) => {
    const chosen = z.enum(['connessioni', 'niente']).parse(keep)
    log.info('app.uninstall', { keep: chosen, by: 'user' })
    beginUninstall(chosen)
    setImmediate(() => app.quit())
  })

  registerDataHandler(
    IPC_CHANNELS.pickAttachments,
    async () => mailService.pickAttachments(getMainWindow() ?? undefined),
    forUser
  )

  registerDataHandler(IPC_CHANNELS.openAttachment, async (payload) => {
    return mailService.openAttachment(payload as AttachmentRef)
  })

  registerDataHandler(
    IPC_CHANNELS.saveAttachment,
    async (payload) =>
      mailService.saveAttachment(payload as AttachmentRef, getMainWindow() ?? undefined),
    forUser
  )

  registerDataHandler(
    IPC_CHANNELS.saveAllAttachments,
    async (ref) => mailService.saveAllAttachments(ref as MessageRef, getMainWindow() ?? undefined),
    forUser
  )

  registerDataHandler(IPC_CHANNELS.copyMessageAttachments, async (payload) => {
    return mailService.copyMessageAttachments(payload as MessageAttachmentsRef)
  })

  registerDataHandler(IPC_CHANNELS.clearAttachmentCache, async () => {
    await mailService.clearAttachmentCache()
  })

  registerDataHandler(IPC_CHANNELS.revealFile, async (filePath: string) => {
    await mailService.revealFile(filePath)
  })

  registerDataHandler(IPC_CHANNELS.openFile, async (filePath: string) =>
    mailService.openFile(filePath)
  )

  registerDataHandler(IPC_CHANNELS.listRecentFiles, async () => mailService.listRecentFiles())

  registerDataHandler(IPC_CHANNELS.messageMarks, async (messages: unknown) =>
    mailService.messageMarks(
      z
        .array(
          z.object({
            accountId: z.string().min(1).max(200),
            messageKey: z.string().min(1).max(2000)
          })
        )
        .max(1000)
        .parse(messages)
    )
  )

  registerDataHandler(IPC_CHANNELS.markedBefore, async (messages: unknown) =>
    mailService.markedBefore(
      z
        .array(
          z.object({
            accountId: z.string().min(1).max(200),
            threadId: z.string().min(1).max(1000),
            from: z.string().max(500).nullable()
          })
        )
        .max(1000)
        .parse(messages)
    )
  )

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

  registerHandler(IPC_CHANNELS.getWindowControlsState, async () => {
    const window = getMainWindow()
    const isWindows = process.platform === 'win32'

    return {
      enabled: isWindows,
      maximized: Boolean(window && !window.isDestroyed() && window.isMaximized()),
      dragTopRegionEnabled: isWindows || process.platform === 'darwin'
    }
  })

  registerHandler(
    IPC_CHANNELS.showContextMenu,
    async (items: ContextMenuItem[]) => {
      const window = getMainWindow()

      if (!window || window.isDestroyed() || !Array.isArray(items)) {
        return null
      }

      return popupPageContextMenu(window, items)
    },
    forUser
  )

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
