import { useMemo } from 'react'
import { toast } from 'sonner'

import { messagesNow } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { MailAttachment, MessageRef } from '@shared/models'

const MESSAGES = defineMessages({
  tryLater: {
    en: 'Try again shortly.',
    it: 'Riprova tra poco.',
    de: 'Versuchen Sie es gleich noch einmal.'
  },
  saved: {
    en: (fileName: string) => `${fileName} saved`,
    it: (fileName: string) => `${fileName} salvato`,
    de: (fileName: string) => `${fileName} gespeichert`
  },
  inFolder: {
    en: (folder: string) => `In ${folder}`,
    it: (folder: string) => `In ${folder}`,
    de: (folder: string) => `In ${folder}`
  },
  show: { en: 'Show', it: 'Mostra', de: 'Zeigen' },
  cannotSave: {
    en: (fileName: string) => `Couldn’t save ${fileName}`,
    it: (fileName: string) => `Impossibile salvare ${fileName}`,
    de: (fileName: string) => `${fileName} konnte nicht gespeichert werden`
  },
  saveAs: { en: 'Save as…', it: 'Salva con nome…', de: 'Speichern unter…' },
  blocked: {
    en: (fileName: string) => `${fileName} can’t be opened from a message`,
    it: (fileName: string) => `${fileName} non si apre da un messaggio`,
    de: (fileName: string) => `${fileName} lässt sich nicht aus einer Nachricht öffnen`
  },
  blockedText: {
    en: 'Files that start programs can only be saved, for safety.',
    it: 'I file che avviano programmi si possono solo salvare, per sicurezza.',
    de: 'Dateien, die Programme starten, lassen sich aus Sicherheitsgründen nur speichern.'
  },
  noApplication: {
    en: (fileName: string) => `No application opens ${fileName}`,
    it: (fileName: string) => `Nessuna applicazione apre ${fileName}`,
    de: (fileName: string) => `Keine Anwendung öffnet ${fileName}`
  },
  noProgramFor: {
    en: (extension: string) => `There is no program for ${extension} files on this computer.`,
    it: (extension: string) => `Su questo computer non c'è un programma per i file ${extension}.`,
    de: (extension: string) => `Auf diesem Computer gibt es kein Programm für ${extension}-Dateien.`
  },
  noProgram: {
    en: 'There is no program for this kind of file on this computer.',
    it: "Su questo computer non c'è un programma per questo tipo di file.",
    de: 'Auf diesem Computer gibt es kein Programm für diesen Dateityp.'
  },
  cannotOpen: {
    en: (fileName: string) => `Couldn’t open ${fileName}`,
    it: (fileName: string) => `Impossibile aprire ${fileName}`,
    de: (fileName: string) => `${fileName} konnte nicht geöffnet werden`
  },
  savedAll: {
    en: (count: number) => (count === 1 ? '1 attachment saved' : `${count} attachments saved`),
    it: (count: number) => (count === 1 ? '1 allegato salvato' : `${count} allegati salvati`),
    de: (count: number) => (count === 1 ? '1 Anhang gespeichert' : `${count} Anhänge gespeichert`)
  },
  cannotSaveAll: {
    en: 'Couldn’t save the attachments',
    it: 'Impossibile salvare gli allegati',
    de: 'Die Anhänge konnten nicht gespeichert werden'
  }
})

export interface AttachmentActions {
  /** Opens the attachment with the application the system uses for its type. */
  open: (attachment: MailAttachment) => Promise<void>
  /** "Save as…" through the system dialog. */
  save: (attachment: MailAttachment) => Promise<void>
  /** Every attachment of the message into one folder the user picks. */
  saveAll: () => Promise<void>
}

function pathParts(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter(Boolean)
}

function fileName(filePath: string): string {
  return pathParts(filePath).at(-1) ?? filePath
}

function folderName(filePath: string): string {
  return pathParts(filePath).at(-2) ?? filePath
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot).toLowerCase() : ''
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : messagesNow(MESSAGES).tryLater
}

/**
 * What the reader does with a message's attachments, each outcome told in a
 * toast: where a file was saved (with a way to show it), and — when a file
 * cannot be opened — why, with "Save as…" one click away.
 */
export function useAttachmentActions(ref: MessageRef | null): AttachmentActions | null {
  const accountId = ref?.accountId
  const folderPath = ref?.folderPath
  const uid = ref?.uid

  return useMemo(() => {
    if (!accountId || !folderPath || !uid) {
      return null
    }

    const messageRef: MessageRef = { accountId, folderPath, uid }

    const save = async (attachment: MailAttachment): Promise<void> => {
      try {
        const filePath = await window.mailApi.saveAttachment({
          ref: messageRef,
          attachmentId: attachment.id
        })

        if (filePath) {
          const m = messagesNow(MESSAGES)
          toast.success(m.saved(fileName(filePath)), {
            description: m.inFolder(folderName(filePath)),
            action: { label: m.show, onClick: () => void window.mailApi.revealFile(filePath) }
          })
        }
      } catch (error) {
        toast.error(messagesNow(MESSAGES).cannotSave(attachment.fileName), {
          description: errorText(error)
        })
      }
    }

    const offerSave = (attachment: MailAttachment): { label: string; onClick: () => void } => ({
      label: messagesNow(MESSAGES).saveAs,
      onClick: () => void save(attachment)
    })

    const open = async (attachment: MailAttachment): Promise<void> => {
      try {
        const result = await window.mailApi.openAttachment({
          ref: messageRef,
          attachmentId: attachment.id
        })

        const m = messagesNow(MESSAGES)

        if (result.status === 'blocked') {
          toast(m.blocked(attachment.fileName), {
            description: m.blockedText,
            action: offerSave(attachment)
          })
        } else if (result.status === 'no-application') {
          const extension = extensionOf(attachment.fileName)
          toast(m.noApplication(attachment.fileName), {
            description: extension ? m.noProgramFor(extension) : m.noProgram,
            action: offerSave(attachment)
          })
        }
      } catch (error) {
        toast.error(messagesNow(MESSAGES).cannotOpen(attachment.fileName), {
          description: errorText(error),
          action: offerSave(attachment)
        })
      }
    }

    const saveAll = async (): Promise<void> => {
      try {
        const saved = await window.mailApi.saveAllAttachments(messageRef)

        if (saved && saved.filePaths.length > 0) {
          const m = messagesNow(MESSAGES)
          toast.success(m.savedAll(saved.filePaths.length), {
            description: m.inFolder(folderName(saved.filePaths[0])),
            action: {
              label: m.show,
              onClick: () => void window.mailApi.revealFile(saved.filePaths[0])
            }
          })
        }
      } catch (error) {
        toast.error(messagesNow(MESSAGES).cannotSaveAll, { description: errorText(error) })
      }
    }

    return { open, save, saveAll }
  }, [accountId, folderPath, uid])
}
