import { defineMessages } from '@shared/i18n'
import { linkedHandles } from '@shared/segretario-links'
import type { ActivityEntry, HandleLink } from '@shared/segretario'

import { messages } from '../../i18n'
import type { StoredEvent } from '../ai-store'
import type {
  ApprovalPayload,
  AssistantPayload,
  ChangesPayload,
  ErrorPayload,
  ToolPayload,
  UserPayload
} from './conversation'
import type { HandleRecord, HandleRegistry } from './handles'

const MESSAGES = defineMessages({
  /** A request with no words to name it by, until it has its title. */
  newWork: { en: 'New task', it: 'Nuovo lavoro', de: 'Neue Aufgabe' }
})

/** The names an event gave, as the page links them. */
export function handleLinks(records: ReadonlyArray<HandleRecord> | undefined): HandleLink[] {
  return (records ?? []).flatMap((record): HandleLink[] => {
    const { handle, target } = record

    switch (target.kind) {
      case 'message':
        return [{ handle, kind: 'message', ref: target.ref, messageKey: target.messageKey }]
      case 'draft':
        return [{ handle, kind: 'draft', draftId: target.draftId }]
      case 'project':
        return [{ handle, kind: 'project', projectId: target.projectId, title: target.title }]
      case 'event':
        return [{ handle, kind: 'event', eventKey: target.eventKey, title: target.title }]
      case 'file':
        return [
          target.file.kind === 'path'
            ? { handle, kind: 'file', fileName: target.file.fileName, path: target.file.path }
            : {
                handle,
                kind: 'file',
                fileName: target.file.fileName,
                ref: target.file.ref,
                attachmentId: target.file.attachmentId
              }
        ]
      default:
        // A name of a kind this build no longer gives.
        return []
    }
  })
}

/**
 * What the short names a text links to stand for, as the run named them:
 * kept with words that stay (the letter, "Il punto", a meeting's
 * preparation), they open what they meant after the run is over.
 */
export function linksIn(text: string, handles: HandleRegistry): HandleLink[] {
  return handleLinks(
    linkedHandles(text).flatMap((handle) => {
      const target = handles.resolve(handle)
      return target ? [{ handle, target }] : []
    })
  )
}

/** What the page shows of a stored event; null for those it does not show. */
export function entryOf(event: StoredEvent): ActivityEntry | null {
  switch (event.type) {
    case 'user': {
      const payload = event.payload as UserPayload
      return {
        kind: 'user',
        id: event.id,
        text: payload.text,
        context: payload.context,
        ...(payload.origin ? { origin: payload.origin } : {}),
        at: event.createdAt,
        handles: handleLinks(payload.handles)
      }
    }
    case 'assistant': {
      const payload = event.payload as AssistantPayload
      return payload.content.trim()
        ? { kind: 'assistant', id: event.id, text: payload.content, at: event.createdAt }
        : null
    }
    case 'tool': {
      const payload = event.payload as ToolPayload
      return {
        kind: 'tool',
        id: event.id,
        at: event.createdAt,
        handles: handleLinks(payload.handles),
        tool: {
          callId: payload.callId,
          name: payload.name,
          status: payload.status,
          summary: payload.summary,
          messages: payload.messages,
          files: payload.files
        }
      }
    }
    case 'approval': {
      const { approvalId, kind, title, status, draft, details, confirmLabel } =
        event.payload as ApprovalPayload
      return {
        kind: 'approval',
        id: event.id,
        approval: { approvalId, kind, title, status, draft, details, confirmLabel },
        at: event.createdAt
      }
    }
    case 'changes':
      return {
        kind: 'changes',
        id: event.id,
        changes: (event.payload as ChangesPayload).changes.map((change) => ({
          object: change.object,
          label: change.label,
          undoable: Boolean(change.undo) && change.undoneAt === undefined,
          undone: change.undoneAt !== undefined,
          accountId: change.accountId,
          messageKeys: change.messageKeys,
          projectIds: change.projectIds
        })),
        at: event.createdAt
      }
    case 'compaction':
      return { kind: 'compaction', id: event.id, at: event.createdAt }
    case 'error':
      return {
        kind: 'error',
        id: event.id,
        message: (event.payload as ErrorPayload).message,
        at: event.createdAt
      }
    default:
      return null
  }
}

/** A first line of a request, as an activity's title until it has one. */
export function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || messages(MESSAGES).newWork
}
