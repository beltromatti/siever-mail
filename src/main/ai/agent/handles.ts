import type { MessageRef } from '@shared/models'

/**
 * Short names for what an activity has seen — `m3` a message, `f2` a file
 * or an attachment, `b1` a draft, `p4` a project, `e2` an event — so the
 * model refers to them in a few characters and the page turns them into
 * links. Each activity has its own; the same message keeps its name for
 * the whole activity.
 */
export type FileTarget =
  | {
      kind: 'attachment'
      ref: MessageRef
      attachmentId: string
      fileName: string
      contentType?: string
    }
  | { kind: 'path'; path: string; fileName: string }

export type HandleTarget =
  | { kind: 'message'; ref: MessageRef; messageKey: string }
  | { kind: 'file'; file: FileTarget }
  | { kind: 'draft'; draftId: string }
  | { kind: 'project'; projectId: string; title: string }
  | { kind: 'event'; eventKey: string; title: string }

/** A name given, as kept in the activity's log to rebuild the registry. */
export interface HandleRecord {
  handle: string
  target: HandleTarget
}

function identityOf(target: HandleTarget): string {
  switch (target.kind) {
    case 'message':
      return `m\u0000${target.ref.accountId}\u0000${target.messageKey}`
    case 'draft':
      return `b\u0000${target.draftId}`
    case 'project':
      return `p\u0000${target.projectId}`
    case 'event':
      return `e\u0000${target.eventKey}`
    case 'file':
      return target.file.kind === 'path'
        ? `f\u0000${target.file.path}`
        : `f\u0000${target.file.ref.accountId}\u0000${target.file.ref.folderPath}\u0000${target.file.ref.uid}\u0000${target.file.attachmentId}`
  }
}

const PREFIX: Readonly<Record<HandleTarget['kind'], string>> = {
  message: 'm',
  file: 'f',
  draft: 'b',
  project: 'p',
  event: 'e'
}

export class HandleRegistry {
  private readonly byHandle = new Map<string, HandleTarget>()
  private readonly byIdentity = new Map<string, string>()
  private readonly counters: Record<string, number> = { m: 0, f: 0, b: 0, p: 0, e: 0 }

  constructor(records: ReadonlyArray<HandleRecord> = []) {
    for (const record of records) {
      this.restore(record)
    }
  }

  /** The name of `target`, given now if it has none yet; `added` collects new names. */
  name(target: HandleTarget, added?: HandleRecord[]): string {
    const identity = identityOf(target)
    const known = this.byIdentity.get(identity)

    if (known) {
      // A message seen again from another folder keeps its name, and is
      // found where it was seen last.
      this.byHandle.set(known, target)
      return known
    }

    const prefix = PREFIX[target.kind]
    this.counters[prefix] += 1
    const handle = `${prefix}${this.counters[prefix]}`
    this.byHandle.set(handle, target)
    this.byIdentity.set(identity, handle)
    added?.push({ handle, target })
    return handle
  }

  resolve(handle: string): HandleTarget | null {
    return this.byHandle.get(handle.trim().toLowerCase()) ?? null
  }

  message(handle: string): { ref: MessageRef; messageKey: string } | null {
    const target = this.resolve(handle)
    return target?.kind === 'message' ? target : null
  }

  file(handle: string): FileTarget | null {
    const target = this.resolve(handle)
    return target?.kind === 'file' ? target.file : null
  }

  draft(handle: string): string | null {
    const target = this.resolve(handle)
    return target?.kind === 'draft' ? target.draftId : null
  }

  project(handle: string): { projectId: string; title: string } | null {
    const target = this.resolve(handle)
    return target?.kind === 'project' ? target : null
  }

  event(handle: string): { eventKey: string; title: string } | null {
    const target = this.resolve(handle)
    return target?.kind === 'event' ? target : null
  }

  private restore({ handle, target }: HandleRecord): void {
    // A name of a kind this build no longer gives (the topics of the first 2.0 builds) is let go.
    if (!(target.kind in PREFIX)) {
      return
    }

    const prefix = handle.charAt(0)
    const number = Number(handle.slice(1))

    this.byHandle.set(handle, target)
    this.byIdentity.set(identityOf(target), handle)

    if (Number.isFinite(number) && number > (this.counters[prefix] ?? 0)) {
      this.counters[prefix] = number
    }
  }
}
