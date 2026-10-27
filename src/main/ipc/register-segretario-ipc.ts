import { ipcMain } from 'electron'
import { z } from 'zod'

import type { SegretarioService } from '@main/ai/segretario-service'
import { logMainError } from '@main/utils/error-utils'
import { SEGRETARIO_IPC } from '@shared/segretario'

const messageRefSchema = z.object({
  accountId: z.string().min(1),
  folderPath: z.string().min(1),
  uid: z.number().int().nonnegative()
})

const contextSchema = z.object({
  messages: z.array(messageRefSchema).max(200),
  accountId: z.string().nullable(),
  folderLabel: z.string().max(200).nullable()
})

const preferencesSchema = z.object({
  triage: z.boolean(),
  readyDrafts: z.boolean(),
  learning: z.boolean().nullable()
})

const memoryPathSchema = z.string().trim().min(1).max(300)

const messageKeysSchema = z
  .array(z.object({ accountId: z.string().min(1), messageKey: z.string().min(1) }))
  .max(1000)

const sendOutcomeSchema = z.union([
  z.object({ sent: z.literal(true) }),
  z.object({ sent: z.literal(false), error: z.string().max(2000) })
])

const composeResultSchema = z.union([
  z.object({ draftId: z.string().min(1) }),
  z.object({ error: z.string().max(2000) })
])

const textSchema = z.string().trim().min(1, 'Scrivi qualcosa al Segretario.').max(20_000)
const idSchema = z.string().min(1).max(100)

/**
 * The Segretario's channels. Each waits for it to be open — after the
 * storage and the mail engine — and checks what the page sends.
 */
export function registerSegretarioIpc(segretario: SegretarioService): void {
  const handle = <Args extends unknown[], Result>(
    channel: string,
    handler: (...args: Args) => Promise<Result> | Result
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_event, ...args: Args) => {
      try {
        await segretario.whenReady()
        return await handler(...args)
      } catch (error) {
        logMainError(`IPC handler failed: ${channel}`, error, { channel })
        throw error instanceof z.ZodError
          ? new Error([...new Set(error.issues.map((issue) => issue.message))].join(' '))
          : error
      }
    })
  }

  handle(SEGRETARIO_IPC.getStatus, () => segretario.getStatus())
  handle(SEGRETARIO_IPC.saveKey, (key: unknown) =>
    segretario.saveKey(z.string().max(500).parse(key))
  )
  handle(SEGRETARIO_IPC.removeKey, () => segretario.removeKey())
  handle(SEGRETARIO_IPC.checkKey, () => segretario.checkKey())
  handle(SEGRETARIO_IPC.getPreferences, () => segretario.getPreferences())
  handle(SEGRETARIO_IPC.getSpending, () => segretario.getSpending())
  handle(SEGRETARIO_IPC.listMemory, () => segretario.listMemory())
  handle(SEGRETARIO_IPC.writeMemory, (path: unknown, content: unknown) =>
    segretario.writeMemory(memoryPathSchema.parse(path), z.string().parse(content))
  )
  handle(SEGRETARIO_IPC.deleteMemory, (path: unknown) =>
    segretario.deleteMemory(memoryPathSchema.parse(path))
  )
  handle(SEGRETARIO_IPC.forgetEverything, () => segretario.forgetEverything())
  handle(SEGRETARIO_IPC.listLearning, () => segretario.listLearning())
  handle(SEGRETARIO_IPC.relearnAccount, (accountId: unknown) =>
    segretario.relearnAccount(idSchema.parse(accountId))
  )
  handle(SEGRETARIO_IPC.getNotes, (messages: unknown) =>
    segretario.getNotes(messageKeysSchema.parse(messages))
  )
  handle(SEGRETARIO_IPC.getThreadBrief, (accountId: unknown, threadId: unknown) =>
    segretario.getThreadBrief(idSchema.parse(accountId), z.string().min(1).parse(threadId))
  )
  handle(SEGRETARIO_IPC.closeCommitment, (id: unknown) =>
    segretario.closeCommitment(z.number().int().positive().parse(id))
  )
  handle(SEGRETARIO_IPC.dismissNote, (accountId: unknown, messageKey: unknown) =>
    segretario.dismissNote(idSchema.parse(accountId), z.string().min(1).parse(messageKey))
  )
  handle(SEGRETARIO_IPC.readyDraftSource, (accountId: unknown, messageKey: unknown) =>
    segretario.readyDraftSource(idSchema.parse(accountId), z.string().min(1).parse(messageKey))
  )
  handle(
    SEGRETARIO_IPC.takeUpReadyDraft,
    (accountId: unknown, messageKey: unknown, draftId: unknown) =>
      segretario.takeUpReadyDraft(
        idSchema.parse(accountId),
        z.string().min(1).parse(messageKey),
        idSchema.parse(draftId)
      )
  )
  handle(SEGRETARIO_IPC.discardReadyDraft, (accountId: unknown, messageKey: unknown) =>
    segretario.discardReadyDraft(idSchema.parse(accountId), z.string().min(1).parse(messageKey))
  )
  handle(SEGRETARIO_IPC.getBriefing, () => segretario.getBriefing())
  handle(SEGRETARIO_IPC.writeBriefingOpening, () => segretario.writeBriefingOpening())
  handle(SEGRETARIO_IPC.draftSent, (draftId: unknown, writtenText: unknown) =>
    segretario.draftSent(idSchema.parse(draftId), z.string().max(200_000).parse(writtenText))
  )
  handle(SEGRETARIO_IPC.setPreferences, (preferences: unknown) =>
    segretario.setPreferences(preferencesSchema.parse(preferences))
  )
  handle(SEGRETARIO_IPC.listActivities, () => segretario.listActivities())
  handle(SEGRETARIO_IPC.getActivity, (id: unknown) => segretario.getActivity(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.startActivity, (text: unknown, context: unknown) =>
    segretario.startActivity(textSchema.parse(text), contextSchema.parse(context))
  )
  handle(SEGRETARIO_IPC.sendMessage, (id: unknown, text: unknown, context: unknown) =>
    segretario.sendMessage(idSchema.parse(id), textSchema.parse(text), contextSchema.parse(context))
  )
  handle(SEGRETARIO_IPC.cancelActivity, (id: unknown) =>
    segretario.cancelActivity(idSchema.parse(id))
  )
  handle(SEGRETARIO_IPC.removeActivity, (id: unknown) =>
    segretario.removeActivity(idSchema.parse(id))
  )
  handle(SEGRETARIO_IPC.markActivitySeen, (id: unknown) =>
    segretario.markActivitySeen(idSchema.parse(id))
  )
  handle(
    SEGRETARIO_IPC.resolveApproval,
    (activityId: unknown, approvalId: unknown, approved: unknown, outcome: unknown) =>
      segretario.resolveApproval(
        idSchema.parse(activityId),
        idSchema.parse(approvalId),
        z.boolean().parse(approved),
        outcome === undefined || outcome === null ? undefined : sendOutcomeSchema.parse(outcome)
      )
  )
  handle(SEGRETARIO_IPC.completeCompose, (requestId: unknown, result: unknown) =>
    segretario.completeCompose(idSchema.parse(requestId), composeResultSchema.parse(result))
  )
}
