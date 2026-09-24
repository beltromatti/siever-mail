import { useMemo } from 'react'
import { toast } from 'sonner'

import type { MailAttachment, MessageRef } from '@shared/models'

export interface AttachmentActions {
  /** Opens the attachment with the application the system uses for its type. */
  open: (attachment: MailAttachment) => Promise<void>
  /** "Salva con nome…" through the system dialog. */
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
  return error instanceof Error && error.message.trim() ? error.message : 'Riprova tra poco.'
}

/**
 * What the reader does with a message's attachments, each outcome told in a
 * toast: where a file was saved (with a way to show it), and — when a file
 * cannot be opened — why, with "Salva con nome…" one click away.
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
          toast.success(`${fileName(filePath)} salvato`, {
            description: `In ${folderName(filePath)}`,
            action: { label: 'Mostra', onClick: () => void window.mailApi.revealFile(filePath) }
          })
        }
      } catch (error) {
        toast.error(`Impossibile salvare ${attachment.fileName}`, { description: errorText(error) })
      }
    }

    const offerSave = (attachment: MailAttachment): { label: string; onClick: () => void } => ({
      label: 'Salva con nome…',
      onClick: () => void save(attachment)
    })

    const open = async (attachment: MailAttachment): Promise<void> => {
      try {
        const result = await window.mailApi.openAttachment({
          ref: messageRef,
          attachmentId: attachment.id
        })

        if (result.status === 'blocked') {
          toast(`${attachment.fileName} non si apre da un messaggio`, {
            description: 'I file che avviano programmi si possono solo salvare, per sicurezza.',
            action: offerSave(attachment)
          })
        } else if (result.status === 'no-application') {
          const extension = extensionOf(attachment.fileName)
          toast(`Nessuna applicazione apre ${attachment.fileName}`, {
            description: extension
              ? `Su questo computer non c'è un programma per i file ${extension}.`
              : "Su questo computer non c'è un programma per questo tipo di file.",
            action: offerSave(attachment)
          })
        }
      } catch (error) {
        toast.error(`Impossibile aprire ${attachment.fileName}`, {
          description: errorText(error),
          action: offerSave(attachment)
        })
      }
    }

    const saveAll = async (): Promise<void> => {
      try {
        const saved = await window.mailApi.saveAllAttachments(messageRef)

        if (saved && saved.filePaths.length > 0) {
          toast.success(
            saved.filePaths.length === 1
              ? '1 allegato salvato'
              : `${saved.filePaths.length} allegati salvati`,
            {
              description: `In ${folderName(saved.filePaths[0])}`,
              action: {
                label: 'Mostra',
                onClick: () => void window.mailApi.revealFile(saved.filePaths[0])
              }
            }
          )
        }
      } catch (error) {
        toast.error('Impossibile salvare gli allegati', { description: errorText(error) })
      }
    }

    return { open, save, saveAll }
  }, [accountId, folderPath, uid])
}
