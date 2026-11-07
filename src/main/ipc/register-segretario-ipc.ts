import { ipcMain, shell } from 'electron'
import { z } from 'zod'

import type { SegretarioService } from '@main/ai/segretario-service'
import { reachablePath } from '@main/services/network-volumes'
import { logMainError } from '@main/utils/error-utils'
import { SEGRETARIO_IPC, type OnboardingState } from '@shared/segretario'

const messageRefSchema = z.object({
  accountId: z.string().min(1),
  folderPath: z.string().min(1),
  uid: z.number().int().nonnegative()
})

const contextSchema = z.object({
  messages: z.array(messageRefSchema).max(200),
  accountId: z.string().nullable(),
  folderLabel: z.string().max(200).nullable(),
  eventKey: z.string().max(2000).nullable().optional()
})

const preferencesSchema = z.object({ enabled: z.boolean() }).strict()

const requestIdSchema = z.string().min(1).max(100)

const reviewRequestSchema = z.object({
  requestId: requestIdSchema,
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
  requestId: requestIdSchema,
  draftId: z.string().min(1).max(100),
  accountId: z.string().min(1),
  instruction: z.string().trim().min(1, 'Scrivi cosa vuoi che scriva.').max(4000),
  writtenText: z.string().max(200_000),
  selectedText: z.string().max(50_000).nullable(),
  subject: z.string().max(2000),
  to: z.array(z.string().max(500)).max(500),
  replyTo: messageRefSchema.nullable()
})

const idSchema = z.string().min(1).max(100)
const messageKeySchema = z.string().min(1).max(1000)
const messageSchema = z.object({ accountId: idSchema, messageKey: messageKeySchema })
const messageKeysSchema = z.array(messageSchema).max(1000)
/** Where an open thing the user adds comes from: a message, an event, or their own word. */
const commitmentFromSchema = z.discriminatedUnion('kind', [
  messageSchema.extend({ kind: z.literal('message') }).strict(),
  z.object({ kind: z.literal('event'), eventKey: z.string().min(1).max(2000) }).strict(),
  z.object({ kind: z.literal('user') }).strict()
])
const threadSchema = z.object({ accountId: idSchema, threadId: z.string().min(1).max(1000) })
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Una data AAAA-MM-GG.')
const commitmentIdSchema = z.number().int().positive()
const commitmentKindSchema = z.enum(['ti_chiedono', 'hai_promesso', 'aspetti', 'da_fare'])
const commitmentTextSchema = z.string().trim().min(1, 'Scrivi cosa c’è da fare.').max(500)
const projectTitleSchema = z.string().trim().min(1, 'Dai un nome.').max(120)

const commitmentStatusSchema = z.enum(['aperta', 'fatta', 'non_serve', 'rinviata'])
const statusOptionsSchema = z
  .object({ until: daySchema.optional(), reason: z.string().trim().max(500).optional() })
  .strict()
  .optional()

const commitmentChangeSchema = z
  .object({
    text: commitmentTextSchema.optional(),
    due: daySchema.nullable().optional(),
    kind: commitmentKindSchema.optional()
  })
  .strict()

const newCommitmentSchema = z
  .object({ kind: commitmentKindSchema, text: commitmentTextSchema, due: daySchema.nullable() })
  .strict()

const projectChangeSchema = z
  .object({
    title: projectTitleSchema.optional(),
    hidden: z.boolean().optional(),
    closed: z.boolean().optional()
  })
  .strict()

const sendOutcomeSchema = z.union([
  z.object({ sent: z.literal(true), queued: z.boolean() }),
  z.object({ sent: z.literal(false), error: z.string().max(2000) })
])

const composeResultSchema = z.union([
  z.object({ draftId: z.string().min(1) }),
  z.object({ error: z.string().max(2000) })
])

const textSchema = z.string().trim().min(1, 'Scrivi qualcosa al Segretario.').max(20_000)

// The page sends the setup whole and `strict` refuses a field it does not know: the fields
// are the shared type's, every one, which the compiler checks.
const onboardingSchema = z
  .object({
    case: z.enum([
      'primo-avvio',
      'nuova-connessione',
      'ai-prima-volta',
      'ai-riaccesa',
      'conoscimi'
    ]),
    step: z.enum(['connessioni', 'segretario', 'preparazione', 'conoscimi', 'lettura', 'entra']),
    accountIds: z.array(z.string().min(1).max(100)).max(100),
    conoscimiId: z.string().min(1).max(100).nullable(),
    startedAt: z.number().int().nonnegative(),
    turnsAiOn: z.boolean().optional()
  } satisfies Record<keyof OnboardingState, z.ZodType>)
  .strict()

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

  // The key and the one switch.
  handle(SEGRETARIO_IPC.getStatus, () => segretario.getStatus())
  handle(SEGRETARIO_IPC.saveKey, (key: unknown) =>
    segretario.saveKey(z.string().max(500).parse(key))
  )
  handle(SEGRETARIO_IPC.removeKey, () => segretario.removeKey())
  handle(SEGRETARIO_IPC.forgetAll, () => segretario.forgetAll())
  handle(SEGRETARIO_IPC.checkKey, () => segretario.checkKey({ byUser: true }))
  handle(SEGRETARIO_IPC.getNotice, () => segretario.getNotice())
  handle(SEGRETARIO_IPC.dismissNotice, () => segretario.dismissNotice())
  handle(SEGRETARIO_IPC.getPreferences, () => segretario.getPreferences())
  handle(SEGRETARIO_IPC.setPreferences, (preferences: unknown) =>
    segretario.setPreferences(preferencesSchema.parse(preferences))
  )
  handle(SEGRETARIO_IPC.getSpending, () => segretario.getSpending())
  handle(SEGRETARIO_IPC.getEngineState, () => segretario.getEngineState())

  // The memory, and getting to know the connections.
  handle(SEGRETARIO_IPC.listMemory, () => segretario.listMemory())
  handle(SEGRETARIO_IPC.writeMemory, (path: unknown, content: unknown, seenRevision: unknown) =>
    segretario.writeMemory(
      memoryPathSchema.parse(path),
      z.string().parse(content),
      z.number().int().positive().optional().parse(seenRevision)
    )
  )
  handle(SEGRETARIO_IPC.deleteMemory, (path: unknown) =>
    segretario.deleteMemory(memoryPathSchema.parse(path))
  )
  handle(SEGRETARIO_IPC.memoryHistory, (path: unknown) =>
    segretario.memoryHistory(memoryPathSchema.parse(path))
  )
  handle(SEGRETARIO_IPC.restoreMemory, (path: unknown, revision: unknown) =>
    segretario.restoreMemory(
      memoryPathSchema.parse(path),
      z.number().int().positive().parse(revision)
    )
  )
  handle(SEGRETARIO_IPC.forgetEverything, () => segretario.forgetEverything())
  handle(SEGRETARIO_IPC.listLearning, () => segretario.listLearning())
  handle(SEGRETARIO_IPC.startConoscimi, (keys: unknown) =>
    segretario.startConoscimi(z.array(z.string().min(1).max(200)).max(100).optional().parse(keys))
  )
  handle(SEGRETARIO_IPC.getOnboarding, () => segretario.getOnboarding())
  handle(SEGRETARIO_IPC.setOnboarding, (state: unknown) =>
    segretario.setOnboarding(onboardingSchema.nullable().parse(state))
  )
  handle(SEGRETARIO_IPC.connectionReadiness, (accountIds: unknown) =>
    segretario.connectionReadiness(z.array(idSchema).max(100).parse(accountIds))
  )
  handle(SEGRETARIO_IPC.getReadingStatus, (accountIds: unknown) =>
    segretario.getReadingStatus(z.array(idSchema).max(200).optional().parse(accountIds))
  )
  handle(SEGRETARIO_IPC.retryReading, (accountIds: unknown) =>
    segretario.retryReading(z.array(idSchema).max(200).optional().parse(accountIds))
  )
  handle(SEGRETARIO_IPC.setPreparing, (preparing: unknown) =>
    segretario.setPreparing(z.boolean().parse(preparing))
  )
  handle(SEGRETARIO_IPC.draftSent, (draftId: unknown, writtenText: unknown) =>
    segretario.draftSent(idSchema.parse(draftId), z.string().max(200_000).parse(writtenText))
  )

  // The user's work.
  handle(SEGRETARIO_IPC.getRowWork, (messages: unknown) =>
    segretario.getRowWork(messageKeysSchema.parse(messages))
  )
  handle(SEGRETARIO_IPC.filingContext, (messages: unknown) =>
    segretario.filingContext(
      z
        .array(
          z.object({
            accountId: idSchema,
            messageKey: messageKeySchema,
            threadId: z.string().min(1).max(1000),
            from: z.string().max(500).nullable()
          })
        )
        .max(1000)
        .parse(messages)
    )
  )
  handle(SEGRETARIO_IPC.getMessageWork, (accountId: unknown, messageKey: unknown) =>
    segretario.getMessageWork(idSchema.parse(accountId), messageKeySchema.parse(messageKey))
  )
  handle(SEGRETARIO_IPC.setCommitmentStatus, (id: unknown, status: unknown, options: unknown) =>
    segretario.setCommitmentStatus(
      commitmentIdSchema.parse(id),
      commitmentStatusSchema.parse(status),
      statusOptionsSchema.parse(options)
    )
  )
  handle(SEGRETARIO_IPC.undoCommitmentStatus, (id: unknown) =>
    segretario.undoCommitmentStatus(z.number().int().positive().parse(id))
  )
  handle(SEGRETARIO_IPC.editCommitment, (id: unknown, changes: unknown) =>
    segretario.editCommitment(commitmentIdSchema.parse(id), commitmentChangeSchema.parse(changes))
  )
  handle(SEGRETARIO_IPC.openCommitment, (from: unknown, input: unknown) =>
    segretario.openCommitment(commitmentFromSchema.parse(from), newCommitmentSchema.parse(input))
  )
  handle(SEGRETARIO_IPC.markHandled, (messages: unknown) =>
    segretario.markHandled(messageKeysSchema.parse(messages))
  )
  handle(SEGRETARIO_IPC.undoChange, (activityId: unknown, eventId: unknown, index: unknown) =>
    segretario.undoChange(
      idSchema.parse(activityId),
      z.number().int().positive().parse(eventId),
      z.number().int().nonnegative().parse(index)
    )
  )
  handle(SEGRETARIO_IPC.replySource, (accountId: unknown, messageKey: unknown) =>
    segretario.replySource(idSchema.parse(accountId), messageKeySchema.parse(messageKey))
  )
  handle(SEGRETARIO_IPC.takeUpReply, (accountId: unknown, messageKey: unknown, draftId: unknown) =>
    segretario.takeUpReply(
      idSchema.parse(accountId),
      messageKeySchema.parse(messageKey),
      idSchema.parse(draftId)
    )
  )
  handle(SEGRETARIO_IPC.discardReply, (accountId: unknown, messageKey: unknown) =>
    segretario.discardReply(idSchema.parse(accountId), messageKeySchema.parse(messageKey))
  )
  handle(SEGRETARIO_IPC.listProposals, () => segretario.listProposals())
  handle(SEGRETARIO_IPC.eventPrep, (eventKey: unknown) =>
    segretario.eventPrep(z.string().min(1).max(2000).parse(eventKey))
  )
  handle(SEGRETARIO_IPC.eventWork, (eventKey: unknown) =>
    segretario.eventWork(z.string().min(1).max(2000).parse(eventKey))
  )
  handle(SEGRETARIO_IPC.commitmentSource, (id: unknown) =>
    segretario.commitmentSource(z.number().int().positive().parse(id))
  )
  handle(
    SEGRETARIO_IPC.decideProposal,
    (id: unknown, accepted: unknown, result: unknown, revision: unknown) =>
      segretario.decideProposal(
        idSchema.parse(id),
        z.boolean().parse(accepted),
        z.record(z.string(), z.unknown()).optional().parse(result),
        z.number().int().positive().optional().parse(revision)
      )
  )

  // The day.
  handle(SEGRETARIO_IPC.getToday, () => segretario.getToday())
  handle(SEGRETARIO_IPC.refreshToday, () => segretario.refreshToday())
  handle(SEGRETARIO_IPC.getDue, (throughDay: unknown) =>
    segretario.getDue(daySchema.parse(throughDay))
  )

  // Writing, rereading, searching.
  handle(SEGRETARIO_IPC.assistWriting, (request: unknown) =>
    segretario.assistWriting(writingRequestSchema.parse(request))
  )
  handle(SEGRETARIO_IPC.reviewDraft, (request: unknown) =>
    segretario.reviewDraft(reviewRequestSchema.parse(request))
  )
  handle(SEGRETARIO_IPC.askMail, (question: unknown, requestId: unknown) =>
    segretario.askMail(
      z.string().trim().min(2, 'Scrivi cosa cerchi.').max(1000).parse(question),
      requestIdSchema.parse(requestId)
    )
  )
  handle(SEGRETARIO_IPC.stopAsking, (requestId: unknown) =>
    segretario.stopAsking(requestIdSchema.parse(requestId))
  )
  handle(SEGRETARIO_IPC.listSavedSearches, () => segretario.listSavedSearches())
  handle(SEGRETARIO_IPC.saveSearch, (id: unknown) => segretario.saveSearch(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.removeSavedSearch, (id: unknown) =>
    segretario.removeSavedSearch(idSchema.parse(id))
  )

  // Projects.
  handle(SEGRETARIO_IPC.listProjects, (options: unknown) =>
    segretario.listProjects(
      z.object({ includeHidden: z.boolean().optional() }).strict().optional().parse(options)
    )
  )
  handle(SEGRETARIO_IPC.getProject, (id: unknown) => segretario.getProject(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.refreshProject, (id: unknown) =>
    segretario.refreshProject(idSchema.parse(id))
  )
  handle(SEGRETARIO_IPC.createProject, (title: unknown) =>
    segretario.createProject(projectTitleSchema.parse(title))
  )
  handle(SEGRETARIO_IPC.updateProject, (id: unknown, change: unknown) =>
    segretario.updateProject(idSchema.parse(id), projectChangeSchema.parse(change))
  )
  handle(SEGRETARIO_IPC.mergeProjects, (keepId: unknown, otherIds: unknown) =>
    segretario.mergeProjects(
      idSchema.parse(keepId),
      z.array(idSchema).min(1).max(50).parse(otherIds)
    )
  )
  handle(
    SEGRETARIO_IPC.setConversationProject,
    (thread: unknown, projectId: unknown, linked: unknown) =>
      segretario.setConversationProject(
        threadSchema.parse(thread),
        idSchema.parse(projectId),
        z.boolean().parse(linked)
      )
  )
  handle(SEGRETARIO_IPC.conversationProjects, (threads: unknown) =>
    segretario.conversationProjects(z.array(threadSchema).max(1000).parse(threads))
  )
  handle(SEGRETARIO_IPC.openProjectFolder, async (id: unknown) => {
    // The archive may be on a share a restart left unmounted, or mounted elsewhere: reached first.
    const folderPath = await reachablePath(await segretario.projectFolder(idSchema.parse(id)))
    const failure = await shell.openPath(folderPath)

    if (failure) {
      throw new Error(`La cartella non si apre: ${failure}`)
    }
  })

  // The panel.
  handle(SEGRETARIO_IPC.listActivities, (options: unknown) =>
    segretario.listActivities(
      z.object({ diary: z.boolean().optional() }).strict().optional().parse(options)
    )
  )
  handle(SEGRETARIO_IPC.getActivity, (id: unknown) => segretario.getActivity(idSchema.parse(id)))
  handle(SEGRETARIO_IPC.startActivity, (text: unknown, context: unknown) =>
    segretario.startActivity(textSchema.parse(text), contextSchema.parse(context))
  )
  handle(SEGRETARIO_IPC.sendMessage, (id: unknown, text: unknown, context: unknown) =>
    segretario.sendMessage(idSchema.parse(id), textSchema.parse(text), contextSchema.parse(context))
  )
  handle(SEGRETARIO_IPC.retryActivity, (id: unknown) =>
    segretario.retryActivity(idSchema.parse(id))
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
