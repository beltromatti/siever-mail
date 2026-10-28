import { ipcMain, shell } from 'electron'
import { z } from 'zod'

import type { SegretarioService } from '@main/ai/segretario-service'
import { ensurePathReachable } from '@main/services/network-volumes'
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
  learning: z.boolean().nullable(),
  reviewBeforeSend: z.boolean()
})

const reviewRequestSchema = z.object({
  accountId: z.string().min(1),
  to: z.array(z.string().max(500)).max(500),
  cc: z.array(z.string().max(500)).max(500),
  subject: z.string().max(2000),
  writtenText: z.string().max(200_000),
  attachments: z.array(z.string().max(500)).max(200),
  replyTo: messageRefSchema.nullable()
})

const memoryPathSchema = z.string().trim().min(1).max(300)

const writingRequestSchema = z.object({
  draftId: z.string().min(1).max(100),
  accountId: z.string().min(1),
  instruction: z.string().trim().min(1, 'Scrivi cosa vuoi che scriva.').max(4000),
  writtenText: z.string().max(200_000),
  subject: z.string().max(2000),
  to: z.array(z.string().max(500)).max(500),
  replyTo: messageRefSchema.nullable()
})

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

const topicChangeSchema = z
  .object({
    title: z.string().trim().min(1, 'Dai un nome.').max(120).optional(),
    archived: z.boolean().optional()
  })
  .strict()

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
  handle(SEGRETARIO_IPC.lastKeptUpAt, () => segretario.lastKeptUpAt())
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
  handle(SEGRETARIO_IPC.dismissConversations, (messages: unknown) =>
    segretario.dismissConversations(messageKeysSchema.parse(messages))
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
  handle(SEGRETARIO_IPC.getDue, (throughDay: unknown) =>
    segretario.getDue(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .parse(throughDay)
    )
  )
  handle(SEGRETARIO_IPC.assistWriting, (request: unknown) =>
    segretario.assistWriting(writingRequestSchema.parse(request))
  )
  handle(SEGRETARIO_IPC.writeBriefingOpening, () => segretario.writeBriefingOpening())
  handle(SEGRETARIO_IPC.topicsLabel, () => segretario.getTopicsLabel())
  handle(SEGRETARIO_IPC.listTopics, () => segretario.listTopics())
  handle(SEGRETARIO_IPC.getTopic, (id: unknown) => segretario.getTopic(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.writeTopicState, (id: unknown) =>
    segretario.writeTopicState(idSchema.parse(id))
  )
  handle(
    SEGRETARIO_IPC.setConversationTopic,
    (accountId: unknown, threadId: unknown, topicId: unknown) =>
      segretario.setConversationTopic(
        idSchema.parse(accountId),
        z.string().min(1).parse(threadId),
        idSchema.nullable().parse(topicId)
      )
  )
  handle(SEGRETARIO_IPC.conversationTopics, (threads: unknown) =>
    segretario.conversationTopics(
      z
        .array(z.object({ accountId: idSchema, threadId: z.string().min(1) }))
        .max(1000)
        .parse(threads)
    )
  )
  handle(SEGRETARIO_IPC.listSavedSearches, () => segretario.listSavedSearches())
  handle(SEGRETARIO_IPC.saveSearch, (id: unknown) => segretario.saveSearch(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.removeSavedSearch, (id: unknown) =>
    segretario.removeSavedSearch(idSchema.parse(id))
  )
  handle(SEGRETARIO_IPC.askMail, (question: unknown) =>
    segretario.askMail(z.string().trim().min(2, 'Scrivi cosa cerchi.').max(1000).parse(question))
  )
  handle(SEGRETARIO_IPC.reviewDraft, (request: unknown) =>
    segretario.reviewDraft(reviewRequestSchema.parse(request))
  )
  handle(SEGRETARIO_IPC.filingHint, (messages: unknown) =>
    segretario.filingHint(
      z
        .array(
          z.object({
            accountId: idSchema,
            threadId: z.string().min(1),
            from: z.string().max(500).nullable()
          })
        )
        .max(1000)
        .parse(messages)
    )
  )
  handle(SEGRETARIO_IPC.createTopic, (title: unknown) =>
    segretario.createTopic(z.string().trim().min(1, 'Dai un nome.').max(120).parse(title))
  )
  handle(SEGRETARIO_IPC.openTopicFolder, async (id: unknown) => {
    // The archive is on a share a restart may have left unmounted: reached first.
    const folderPath = await segretario.topicFolder(idSchema.parse(id))
    await ensurePathReachable(folderPath)
    const failure = await shell.openPath(folderPath)

    if (failure) {
      throw new Error(`La cartella non si apre: ${failure}`)
    }
  })
  handle(SEGRETARIO_IPC.updateTopic, (id: unknown, change: unknown) =>
    segretario.updateTopic(idSchema.parse(id), topicChangeSchema.parse(change))
  )
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
