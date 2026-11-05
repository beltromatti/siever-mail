import { randomUUID } from 'node:crypto'

import { placeholders, type Sql } from '../sql'
import {
  RegistryRefusal,
  type Actor,
  type ActorKind,
  type ProjectLink,
  type ProjectRecord,
  type ProjectResource,
  type ProjectSummary,
  type ThreadRef
} from './types'

interface ProjectRow {
  id: string
  title: string
  title_by: string
  description: string | null
  state: string | null
  state_at: number | null
  stale_since: number | null
  origin: string
  hidden_at: number | null
  closed_at: number | null
  active_at: number | null
  revision: number
  created_at: number
  updated_at: number
}

const COLUMNS = `p.id, p.title, p.title_by, p.description, p.state, p.state_at, p.stale_since, p.origin,
  p.hidden_at, p.closed_at, p.active_at, p.revision, p.created_at, p.updated_at`

function actorKind(value: string): ActorKind {
  return value === 'utente' || value === 'sistema' ? value : 'segretario'
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : Number(value)
}

function recordOf(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    title: row.title,
    titleBy: actorKind(row.title_by),
    description: row.description,
    state: row.state,
    stateAt: nullableNumber(row.state_at),
    staleSince: nullableNumber(row.stale_since),
    origin: actorKind(row.origin),
    hiddenAt: nullableNumber(row.hidden_at),
    closedAt: nullableNumber(row.closed_at),
    activeAt: nullableNumber(row.active_at),
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

/** A name as it is compared: case, accents, spacing and punctuation aside. */
export function foldTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const SUMMARY_SELECT = `
  SELECT ${COLUMNS},
    (SELECT COUNT(*) FROM ai_project_threads t WHERE t.project_id = p.id AND t.rejected = 0) AS conversations,
    (SELECT COUNT(*) FROM ai_items i
       JOIN ai_project_threads t ON t.account_id = i.account_id AND t.thread_id = i.thread_id
       WHERE t.project_id = p.id AND t.rejected = 0 AND i.status = 'aperta') AS open_commitments,
    (SELECT MAX(n.message_date) FROM ai_notes n
       JOIN ai_project_threads t ON t.account_id = n.account_id AND t.thread_id = n.thread_id
       WHERE t.project_id = p.id AND t.rejected = 0) AS last_message_at
  FROM ai_projects p`

type SummaryRow = ProjectRow & {
  conversations: number
  open_commitments: number
  last_message_at: string | null
}

function summaryOf(row: SummaryRow): ProjectSummary {
  return {
    ...recordOf(row),
    conversations: Number(row.conversations),
    openCommitments: Number(row.open_commitments),
    lastMessageAt: row.last_message_at
  }
}

/**
 * The projects: the matters that last, which conversations belong to — one
 * conversation to more than one, now and then. The Segretario makes,
 * names and fills them as it reads; the user renames, merges, moves a
 * conversation out or in, hides: what the user decides stays, and a run
 * in the background does not undo it.
 */
export class ProjectStore {
  constructor(private readonly sql: Sql) {}

  async get(id: string): Promise<ProjectRecord | null> {
    const row = await this.sql.get<ProjectRow>(
      `SELECT ${COLUMNS} FROM ai_projects p WHERE p.id = ?`,
      id
    )
    return row ? recordOf(row) : null
  }

  async summary(id: string): Promise<ProjectSummary | null> {
    const row = await this.sql.get<SummaryRow>(`${SUMMARY_SELECT} WHERE p.id = ?`, id)
    return row ? summaryOf(row) : null
  }

  /** The projects, the most recently moved first; hidden and closed ones only when asked. */
  async list(
    options: { includeHidden?: boolean; includeClosed?: boolean } = {}
  ): Promise<ProjectSummary[]> {
    const where: string[] = []

    if (!options.includeHidden) {
      where.push('p.hidden_at IS NULL')
    }

    if (!options.includeClosed) {
      where.push('p.closed_at IS NULL')
    }

    const rows = await this.sql.all<SummaryRow>(
      `${SUMMARY_SELECT} ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(last_message_at, '') DESC, p.updated_at DESC`
    )
    return rows.map(summaryOf)
  }

  /** Projects whose name or description has these words, hidden and closed ones too. */
  async search(query: string): Promise<ProjectSummary[]> {
    const words = foldTitle(query).split(' ').filter(Boolean)

    if (words.length === 0) {
      return this.list()
    }

    const all = await this.list({ includeHidden: true, includeClosed: true })
    return all.filter((project) => {
      const haystack = foldTitle(`${project.title} ${project.description ?? ''}`)
      return words.every((word) => haystack.includes(word))
    })
  }

  /**
   * Makes a project — or returns the one already called so: a project made
   * twice is made once.
   */
  async create(
    title: string,
    actor: Actor,
    options: { description?: string | null } = {}
  ): Promise<{ record: ProjectRecord; created: boolean }> {
    const name = title.trim()

    if (!name) {
      throw new RegistryRefusal('Un progetto ha bisogno di un nome.')
    }

    const folded = foldTitle(name)
    const existing = (await this.list({ includeHidden: true })).find(
      (project) => foldTitle(project.title) === folded
    )

    if (existing) {
      return { record: existing, created: false }
    }

    const now = Date.now()
    const row = await this.sql.get<ProjectRow>(
      `INSERT INTO ai_projects (
        id, title, title_by, description, state, state_at, stale_since, origin, hidden_at,
        closed_at, active_at, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, 1, ?, ?)
      RETURNING id, title, title_by, description, state, state_at, stale_since, origin, hidden_at,
        closed_at, active_at, revision, created_at, updated_at`,
      randomUUID(),
      name,
      actor.by,
      options.description?.trim() || null,
      actor.by,
      now,
      now,
      now
    )
    return { record: recordOf(row!), created: true }
  }

  async rename(id: string, title: string, actor: Actor): Promise<ProjectRecord> {
    const name = title.trim()

    if (!name) {
      throw new RegistryRefusal('Un progetto ha bisogno di un nome.')
    }

    const current = await this.require(id)

    if (current.titleBy === 'utente' && actor.by === 'segretario' && actor.background) {
      throw new RegistryRefusal(`Il nome «${current.title}» l'ha dato l'utente: lascialo.`, current)
    }

    return this.update(id, { title: name, title_by: actor.by })
  }

  async describe(id: string, description: string, actor: Actor): Promise<ProjectRecord> {
    void actor
    await this.require(id)
    return this.update(id, { description: description.trim() || null })
  }

  /** Writes "Il punto": where the project stands now. It is current again. */
  async setState(id: string, state: string, actor: Actor): Promise<ProjectRecord> {
    void actor
    await this.require(id)
    return this.update(id, { state: state.trim() || null, state_at: Date.now(), stale_since: null })
  }

  /** Something moved in these projects after "Il punto" was written. */
  async markStale(projectIds: ReadonlyArray<string>): Promise<void> {
    if (projectIds.length === 0) {
      return
    }

    await this.sql.run(
      `UPDATE ai_projects SET stale_since = COALESCE(stale_since, ?), active_at = ?
       WHERE id IN (${placeholders(projectIds)})`,
      Date.now(),
      Date.now(),
      ...projectIds
    )
  }

  /** The projects whose "Il punto" is behind, the longest first. */
  async stale(): Promise<ProjectRecord[]> {
    const rows = await this.sql.all<ProjectRow>(
      `SELECT ${COLUMNS} FROM ai_projects p
       WHERE p.stale_since IS NOT NULL AND p.hidden_at IS NULL AND p.closed_at IS NULL
       ORDER BY p.stale_since`
    )
    return rows.map(recordOf)
  }

  async setHidden(id: string, hidden: boolean, actor: Actor): Promise<ProjectRecord> {
    const current = await this.require(id)

    if (!hidden && current.hiddenAt !== null && actor.background) {
      throw new RegistryRefusal("L'utente l'ha nascosto: lascialo così.", current)
    }

    return this.update(id, { hidden_at: hidden ? Date.now() : null })
  }

  async setClosed(id: string, closed: boolean, actor: Actor): Promise<ProjectRecord> {
    void actor
    await this.require(id)
    return this.update(id, { closed_at: closed ? Date.now() : null })
  }

  /**
   * Takes away a project made by mistake, with what was filed in it — not
   * one the user has worked on since: that one is hidden or merged instead.
   */
  async remove(id: string): Promise<ProjectRecord> {
    const current = await this.require(id)
    const byUser = await this.sql.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_project_threads WHERE project_id = ? AND linked_by = 'utente'`,
      id
    )

    if (current.titleBy === 'utente' || (byUser?.n ?? 0) > 0) {
      throw new RegistryRefusal(
        `Su «${current.title}» hai già lavorato tu: nascondilo o uniscilo a un altro.`,
        current
      )
    }

    await this.sql.run('DELETE FROM ai_project_threads WHERE project_id = ?', id)
    await this.sql.run('DELETE FROM ai_project_resources WHERE project_id = ?', id)
    await this.sql.run('DELETE FROM ai_projects WHERE id = ?', id)
    return current
  }

  /**
   * Several projects that are one: the first keeps its name, takes the
   * others' conversations and resources; the others go.
   */
  async merge(
    keepId: string,
    dropIds: ReadonlyArray<string>,
    actor: Actor
  ): Promise<ProjectRecord> {
    await this.require(keepId)
    const dropping = dropIds.filter((id) => id !== keepId)

    for (const id of dropping) {
      await this.require(id)
      await this.sql.run(
        `INSERT OR IGNORE INTO ai_project_threads (project_id, account_id, thread_id, linked_by, rejected, created_at)
         SELECT ?, account_id, thread_id, ?, rejected, created_at FROM ai_project_threads WHERE project_id = ?`,
        keepId,
        actor.by,
        id
      )
      await this.sql.run(
        `INSERT OR IGNORE INTO ai_project_resources (project_id, kind, location, label, added_by, created_at)
         SELECT ?, kind, location, label, added_by, created_at FROM ai_project_resources WHERE project_id = ?`,
        keepId,
        id
      )
      await this.sql.run('DELETE FROM ai_project_threads WHERE project_id = ?', id)
      await this.sql.run('DELETE FROM ai_project_resources WHERE project_id = ?', id)
      await this.sql.run('DELETE FROM ai_projects WHERE id = ?', id)
    }

    await this.markStale([keepId])
    return this.require(keepId)
  }

  /**
   * Files a conversation into a project. Never one the user took out of
   * it, from the background; for the user it is filed again.
   */
  async link(
    projectId: string,
    thread: ThreadRef,
    actor: Actor
  ): Promise<{ link: ProjectLink; changed: boolean }> {
    await this.require(projectId)
    const existing = await this.linkOf(projectId, thread)

    if (existing && !existing.rejected) {
      return { link: existing, changed: false }
    }

    if (existing?.rejected && actor.by !== 'utente') {
      throw new RegistryRefusal(
        "L'utente ha tolto questa conversazione da questo progetto: non rimetterla.",
        existing
      )
    }

    await this.sql.run(
      `INSERT INTO ai_project_threads (project_id, account_id, thread_id, linked_by, rejected, created_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(project_id, account_id, thread_id) DO UPDATE SET rejected = 0, linked_by = excluded.linked_by`,
      projectId,
      thread.accountId,
      thread.threadId,
      actor.by,
      Date.now()
    )
    await this.markStale([projectId])
    return { link: (await this.linkOf(projectId, thread))!, changed: true }
  }

  /**
   * Takes a conversation out of a project. The user's word is kept — the
   * conversation is not filed there again; the Segretario cannot take out
   * what the user put in, from the background.
   */
  async unlink(projectId: string, thread: ThreadRef, actor: Actor): Promise<boolean> {
    const existing = await this.linkOf(projectId, thread)

    if (actor.by === 'utente') {
      await this.sql.run(
        `INSERT INTO ai_project_threads (project_id, account_id, thread_id, linked_by, rejected, created_at)
         VALUES (?, ?, ?, 'utente', 1, ?)
         ON CONFLICT(project_id, account_id, thread_id) DO UPDATE SET rejected = 1, linked_by = 'utente'`,
        projectId,
        thread.accountId,
        thread.threadId,
        Date.now()
      )
      await this.markStale([projectId])
      return Boolean(existing && !existing.rejected)
    }

    if (!existing || existing.rejected) {
      return false
    }

    if (existing.linkedBy === 'utente' && actor.background) {
      throw new RegistryRefusal(
        "L'utente ha messo lui questa conversazione nel progetto: lasciala.",
        existing
      )
    }

    await this.sql.run(
      'DELETE FROM ai_project_threads WHERE project_id = ? AND account_id = ? AND thread_id = ?',
      projectId,
      thread.accountId,
      thread.threadId
    )
    await this.markStale([projectId])
    return true
  }

  /** The links of these conversations: in which projects they are, and where the user said they are not. */
  async linksOf(threads: ReadonlyArray<ThreadRef>): Promise<ProjectLink[]> {
    if (threads.length === 0) {
      return []
    }

    const rows = await this.sql.all<{
      project_id: string
      account_id: string
      thread_id: string
      linked_by: string
      rejected: number
    }>(
      `SELECT project_id, account_id, thread_id, linked_by, rejected FROM ai_project_threads
       WHERE ${threads.map(() => '(account_id = ? AND thread_id = ?)').join(' OR ')}`,
      ...threads.flatMap((thread) => [thread.accountId, thread.threadId])
    )
    return rows.map((row) => ({
      projectId: row.project_id,
      accountId: row.account_id,
      threadId: row.thread_id,
      linkedBy: actorKind(row.linked_by),
      rejected: Number(row.rejected) === 1
    }))
  }

  /** The conversations of a project. */
  async threadsOf(projectId: string, accountIds?: ReadonlyArray<string>): Promise<ThreadRef[]> {
    const rows = await this.sql.all<{ account_id: string; thread_id: string }>(
      `SELECT account_id, thread_id FROM ai_project_threads
       WHERE project_id = ? AND rejected = 0
       ${accountIds ? `AND account_id IN (${placeholders(accountIds)})` : ''}`,
      projectId,
      ...(accountIds ?? [])
    )
    return rows.map((row) => ({ accountId: row.account_id, threadId: row.thread_id }))
  }

  async resources(projectId: string): Promise<ProjectResource[]> {
    const rows = await this.sql.all<{
      id: number
      project_id: string
      kind: string
      location: string
      label: string | null
      added_by: string
    }>('SELECT * FROM ai_project_resources WHERE project_id = ? ORDER BY id', projectId)
    return rows.map((row) => ({
      id: Number(row.id),
      projectId: row.project_id,
      kind: row.kind === 'link' ? 'link' : 'cartella',
      location: row.location,
      label: row.label,
      addedBy: actorKind(row.added_by)
    }))
  }

  async addResource(
    projectId: string,
    resource: { kind: 'cartella' | 'link'; location: string; label?: string | null },
    actor: Actor
  ): Promise<ProjectResource[]> {
    await this.require(projectId)
    const location = resource.location.trim()

    if (!location) {
      throw new RegistryRefusal('Manca dove si trova.')
    }

    await this.sql.run(
      `INSERT INTO ai_project_resources (project_id, kind, location, label, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, location) DO UPDATE SET label = COALESCE(excluded.label, label)`,
      projectId,
      resource.kind,
      location,
      resource.label?.trim() || null,
      actor.by,
      Date.now()
    )
    return this.resources(projectId)
  }

  async removeResource(
    projectId: string,
    location: string,
    actor: Actor
  ): Promise<ProjectResource[]> {
    const current = (await this.resources(projectId)).find(
      (resource) => resource.location === location
    )

    if (current?.addedBy === 'utente' && actor.background) {
      throw new RegistryRefusal("Questa cartella l'ha collegata l'utente: lasciala.")
    }

    await this.sql.run(
      'DELETE FROM ai_project_resources WHERE project_id = ? AND location = ?',
      projectId,
      location
    )
    return this.resources(projectId)
  }

  /** Something happened in these conversations: their projects are behind on "Il punto". */
  async markStaleByThreads(threads: ReadonlyArray<ThreadRef>): Promise<string[]> {
    const ids = [
      ...new Set(
        (await this.linksOf(threads)).filter((link) => !link.rejected).map((link) => link.projectId)
      )
    ]
    await this.markStale(ids)
    return ids
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private async require(id: string): Promise<ProjectRecord> {
    const record = await this.get(id)

    if (!record) {
      throw new RegistryRefusal(`Non esiste un progetto ${id}.`)
    }

    return record
  }

  private async linkOf(projectId: string, thread: ThreadRef): Promise<ProjectLink | null> {
    return (await this.linksOf([thread])).find((link) => link.projectId === projectId) ?? null
  }

  private async update(id: string, fields: Record<string, unknown>): Promise<ProjectRecord> {
    const names = Object.keys(fields)
    await this.sql.run(
      `UPDATE ai_projects SET ${names.map((name) => `${name} = ?`).join(', ')},
         revision = revision + 1, updated_at = ?
       WHERE id = ?`,
      ...names.map((name) => fields[name]),
      Date.now(),
      id
    )
    return this.require(id)
  }
}
