import type { Sql } from '../sql'
import { foldTitle } from '../registry/projects'
import { RegistryRefusal, type Actor } from '../registry/types'

/**
 * Past this length a note is long for what it is — every run that opens it
 * reads it all — and the tool says so; whether to put it in order, or split
 * it, is the Segretario's.
 */
export const LONG_NOTE_CHARS = 20_000

/** A folder of more notes than this shows in the index as one line, opened when needed. */
const INDEX_FOLDER_LISTED = 12
const INDEX_FOLDER_RECENT = 5

/** How many past versions of a note are kept. */
const VERSIONS_KEPT = 40

export interface MemoryDocument {
  path: string
  content: string
  revision: number
  createdAt: number
  updatedAt: number
  /** Who wrote it last: `utente`, or the run of the Segretario's that did. */
  updatedBy: string | null
}

export interface MemoryVersion {
  revision: number
  /** Null for the version that deleted the note. */
  content: string | null
  action: string
  actor: string
  runId: string | null
  at: number
}

interface MemoryRow {
  path: string
  content: string
  revision: number
  created_at: number
  updated_at: number
  updated_by: string | null
}

function documentOf(row: MemoryRow): MemoryDocument {
  return {
    path: row.path,
    content: row.content,
    revision: Number(row.revision),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    updatedBy: row.updated_by
  }
}

/** A note's path as kept: relative, with forward slashes, ending in `.md`, never climbing out. */
export function normalizeMemoryPath(path: string): string {
  const cleaned = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^memoria\//, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/')

  if (!cleaned || cleaned.split('/').includes('..')) {
    throw new RegistryRefusal(`Percorso non valido: «${path}».`)
  }

  return cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`
}

/** The first line of a note, which says what it is about. */
export function memoryHeadline(content: string): string {
  const line = content.split('\n').find((candidate) => candidate.trim()) ?? ''
  return line
    .replace(/^#+\s*/, '')
    .trim()
    .slice(0, 160)
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

/**
 * A replacement as the note has it. Copied from a numbered reading, a
 * passage may carry the spaces that part number and line: when it is not
 * found as written but is, once, without them at its lines' starts, it is
 * that passage — and its replacement loses the same spaces.
 */
function asWritten(
  content: string,
  edit: { old: string; new: string }
): { old: string; new: string } {
  if (content.includes(edit.old)) {
    return edit
  }

  const unmargined = (value: string): string => value.replace(/^[ \t]{1,2}/gm, '')
  const old = unmargined(edit.old)
  return old !== edit.old && content.split(old).length === 2
    ? { old, new: unmargined(edit.new) }
    : edit
}

/**
 * The Segretario's notebook: Markdown notes it organises as it likes,
 * shared by every run. What it guarantees is integrity, not shape: every
 * version is kept, with who wrote it; edits are patches — they apply to
 * the text as it is now, so two runs editing different lines both land;
 * a whole-note rewrite made on an old reading is refused, never a silent
 * overwrite of what another run wrote in between.
 */
export class Notebook {
  constructor(private readonly sql: Sql) {}

  async list(): Promise<MemoryDocument[]> {
    const rows = await this.sql.all<MemoryRow>(
      'SELECT path, content, revision, created_at, updated_at, updated_by FROM ai_memory ORDER BY path'
    )
    return rows.map(documentOf)
  }

  async read(path: string): Promise<MemoryDocument | null> {
    const row = await this.sql.get<MemoryRow>(
      'SELECT path, content, revision, created_at, updated_at, updated_by FROM ai_memory WHERE path = ?',
      path
    )

    if (row) {
      await this.sql.run('UPDATE ai_memory SET read_at = ? WHERE path = ?', Date.now(), path)
    }

    return row ? documentOf(row) : null
  }

  /**
   * The memory as every run begins with it: a map, not the notes. Each note
   * with its first line; a folder of many notes as one line — how many, the
   * ones touched last — opened with \`leggi\` when the work needs it, so the
   * map stays small however much the memory grows.
   */
  async index(): Promise<string> {
    const notes = await this.list()

    if (notes.length === 0) {
      return '(la memoria è vuota)'
    }

    const folders = new Map<string, MemoryDocument[]>()

    for (const note of notes) {
      const folder = note.path.includes('/') ? note.path.slice(0, note.path.indexOf('/')) : ''
      folders.set(folder, [...(folders.get(folder) ?? []), note])
    }

    const line = (note: MemoryDocument): string =>
      `- ${note.path} — ${memoryHeadline(note.content)}`

    return [...folders.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .flatMap(([folder, inFolder]) => {
        if (folder === '' || inFolder.length <= INDEX_FOLDER_LISTED) {
          return inFolder.map(line)
        }

        const recent = [...inFolder]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, INDEX_FOLDER_RECENT)
          .map((note) => note.path.slice(folder.length + 1))
        return [
          `- ${folder}/ — ${inFolder.length} note (le ultime toccate: ${recent.join(', ')}): \`leggi\` con \`${folder}/\` le elenca`
        ]
      })
      .join('\n')
  }

  /** The notes of a folder, each with its first line; null when there is no such folder. */
  async folder(path: string): Promise<string | null> {
    const prefix = `${path.replace(/^\/+|\/+$/g, '')}/`
    const notes = (await this.list()).filter((note) => note.path.startsWith(prefix))
    return notes.length === 0
      ? null
      : notes.map((note) => `- ${note.path} — ${memoryHeadline(note.content)}`).join('\n')
  }

  /** Lines of every note that hold all these words, with their numbers. */
  async search(
    query: string,
    limit = 60
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    const words = fold(query)
      .split(/\s+/)
      .filter((word) => word.length > 0)

    if (words.length === 0) {
      return []
    }

    const hits: Array<{ path: string; line: number; text: string }> = []

    for (const note of await this.list()) {
      const lines = note.content.split('\n')
      const path = fold(note.path)
      // Words all in the note's name find the note, once — not every line of it.
      const byName = words.every((word) => path.includes(word))
      let found = false

      lines.forEach((text, index) => {
        const line = fold(text)

        if (
          words.every((word) => path.includes(word) || line.includes(word)) &&
          (!byName || words.some((word) => line.includes(word)))
        ) {
          hits.push({ path: note.path, line: index + 1, text })
          found = true
        }
      })

      if (byName && !found) {
        hits.push({ path: note.path, line: 1, text: lines[0] ?? '' })
      }
    }

    return hits.slice(0, limit)
  }

  /**
   * Writes a whole note, new or over the old. Over one changed since
   * `seenRevision` it is refused, with the note as it is now.
   */
  async write(
    path: string,
    content: string,
    actor: Actor,
    options: { seenRevision?: number } = {}
  ): Promise<{ document: MemoryDocument; created: boolean }> {
    const text = content.trimEnd() + '\n'
    const current = await this.read(path)

    if (
      current &&
      options.seenRevision !== undefined &&
      current.revision !== options.seenRevision
    ) {
      throw new RegistryRefusal(
        `${path} è cambiata da quando l'hai letta (ora è la versione ${current.revision}): rileggila e modifica solo ciò che serve.`,
        current
      )
    }

    if (!current) {
      const now = Date.now()
      const inserted = await this.sql.run(
        `INSERT INTO ai_memory (path, content, created_at, updated_at, read_at, revision, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(path) DO NOTHING`,
        path,
        text,
        now,
        now,
        now,
        this.author(actor)
      )

      if (inserted === 1) {
        await this.keep(path, 1, text, 'scrivi', actor)
        return { document: (await this.read(path))!, created: true }
      }

      // Created meanwhile by another run: refused like any write on an old look.
      throw new RegistryRefusal(
        `${path} è stata appena creata da un altro lavoro: rileggila.`,
        await this.read(path)
      )
    }

    return { document: await this.replaceOrRefuse(current, text, 'scrivi', actor), created: false }
  }

  /**
   * Replaces passages, all or none, each found exactly once in the note as
   * it is now: a patch, not a rewrite.
   */
  async edit(
    path: string,
    edits: ReadonlyArray<{ old: string; new: string }>,
    actor: Actor
  ): Promise<MemoryDocument> {
    if (edits.length === 0) {
      throw new RegistryRefusal('Nessuna modifica indicata.')
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.require(path)
      let text = current.content

      for (const edit of edits) {
        if (!edit.old) {
          throw new RegistryRefusal('Ogni modifica ha bisogno del testo da cambiare (`vecchio`).')
        }

        const { old, new: replacement } = asWritten(text, edit)
        const count = text.split(old).length - 1

        if (count !== 1) {
          throw new RegistryRefusal(
            count === 0
              ? `«${old.slice(0, 120)}» non compare in ${path}: rileggi la nota.`
              : `«${old.slice(0, 120)}» compare ${count} volte in ${path}: indica un testo più lungo, che compaia una volta sola.`,
            current
          )
        }

        text = text.replace(old, () => replacement)
      }

      try {
        return await this.replace(current, text, 'modifica', actor)
      } catch (error) {
        // Another run wrote in between: the patch is applied again to what it wrote.
        if (!(error instanceof ConcurrentWrite)) {
          throw error
        }
      }
    }

    throw new RegistryRefusal(`${path} cambia di continuo: riprova tra poco.`)
  }

  /**
   * Inserts text after a line (at the end without one). A line counted on a
   * version this run read is the line meant only while the note is still
   * that version: changed since, the insertion is refused with the note as
   * it is now — the end of a note, though, stays the end.
   */
  async insert(
    path: string,
    afterLine: number | null,
    text: string,
    actor: Actor,
    options: { seenRevision?: number } = {}
  ): Promise<MemoryDocument> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.read(path)

      if (!current) {
        return (await this.write(path, text, actor)).document
      }

      if (
        afterLine !== null &&
        options.seenRevision !== undefined &&
        current.revision !== options.seenRevision
      ) {
        throw new RegistryRefusal(
          `${path} è cambiata da quando l'hai letta (ora è la versione ${current.revision}): la riga ${afterLine} non è più quella che hai visto.`,
          current
        )
      }

      const lines = current.content.replace(/\n$/, '').split('\n')
      const at = Math.max(0, Math.min(lines.length, afterLine ?? lines.length))
      lines.splice(at, 0, ...text.replace(/\n$/, '').split('\n'))
      const next = lines.join('\n') + '\n'

      try {
        return await this.replace(current, next, 'inserisci', actor)
      } catch (error) {
        if (!(error instanceof ConcurrentWrite)) {
          throw error
        }
      }
    }

    throw new RegistryRefusal(`${path} cambia di continuo: riprova tra poco.`)
  }

  async delete(path: string, actor: Actor): Promise<boolean> {
    const current = await this.read(path)

    if (!current) {
      return false
    }

    await this.sql.run('DELETE FROM ai_memory WHERE path = ?', path)
    await this.keep(path, current.revision + 1, null, 'elimina', actor)
    return true
  }

  async rename(from: string, to: string, actor: Actor): Promise<MemoryDocument> {
    const current = await this.require(from)

    if (await this.read(to)) {
      throw new RegistryRefusal(`Esiste già una nota «${to}».`)
    }

    await this.sql.run(
      'UPDATE ai_memory SET path = ?, updated_at = ?, updated_by = ? WHERE path = ?',
      to,
      Date.now(),
      this.author(actor),
      from
    )
    await this.sql.run('UPDATE ai_memory_history SET path = ? WHERE path = ?', to, from)
    await this.keep(to, current.revision, current.content, `rinomina da ${from}`, actor)
    return this.require(to)
  }

  /** The versions of a note, the newest first. */
  async history(path: string, limit = 20): Promise<MemoryVersion[]> {
    const rows = await this.sql.all<{
      revision: number
      content: string | null
      action: string
      actor: string
      run_id: string | null
      at: number
    }>(
      'SELECT revision, content, action, actor, run_id, at FROM ai_memory_history WHERE path = ? ORDER BY id DESC LIMIT ?',
      path,
      limit
    )
    return rows.map((row) => ({
      revision: Number(row.revision),
      content: row.content,
      action: row.action,
      actor: row.actor,
      runId: row.run_id,
      at: Number(row.at)
    }))
  }

  /** Brings back a past version of a note, as a new one. */
  async restore(path: string, revision: number, actor: Actor): Promise<MemoryDocument> {
    const version = (await this.history(path, VERSIONS_KEPT)).find(
      (candidate) => candidate.revision === revision && candidate.content !== null
    )

    if (!version?.content) {
      throw new RegistryRefusal(`Non trovo la versione ${revision} di ${path}.`)
    }

    const current = await this.read(path)

    if (!current) {
      return (await this.write(path, version.content, actor)).document
    }

    return this.replaceOrRefuse(current, version.content, `ripristina ${revision}`, actor)
  }

  async clear(): Promise<void> {
    await this.sql.run('DELETE FROM ai_memory')
    await this.sql.run('DELETE FROM ai_memory_history')
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  private async require(path: string): Promise<MemoryDocument> {
    const current = await this.read(path)

    if (!current) {
      throw new RegistryRefusal(await this.missing(path))
    }

    return current
  }

  /**
   * What to say of a note that is not there: the notes called most like it,
   * by the words of its path, or the index when none is.
   */
  async missing(path: string): Promise<string> {
    const words = (value: string): string[] =>
      foldTitle(value.replace(/\.md$/, ''))
        .split(' ')
        .filter((word) => word.length > 2)
    const wanted = new Set(words(path))
    const near = (await this.list())
      .map((note) => ({
        note,
        shared: words(`${note.path} ${memoryHeadline(note.content)}`).filter((word) =>
          wanted.has(word)
        ).length
      }))
      .filter((candidate) => candidate.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 5)

    return near.length > 0
      ? `La nota «${path}» non esiste. Le più vicine: ${near
          .map((candidate) => `${candidate.note.path} (${memoryHeadline(candidate.note.content)})`)
          .join('; ')}.`
      : `La nota «${path}» non esiste. ${await this.index()}`
  }

  /** `replace`, with a write that lost the race said back as a refusal. */
  private async replaceOrRefuse(
    current: MemoryDocument,
    content: string,
    action: string,
    actor: Actor
  ): Promise<MemoryDocument> {
    try {
      return await this.replace(current, content, action, actor)
    } catch (error) {
      if (error instanceof ConcurrentWrite) {
        throw new RegistryRefusal(
          `${current.path} è stata cambiata in questo momento da un altro lavoro: rileggila.`,
          await this.read(current.path)
        )
      }

      throw error
    }
  }

  /** Writes over `current` if nobody wrote since; otherwise `ConcurrentWrite`. */
  private async replace(
    current: MemoryDocument,
    content: string,
    action: string,
    actor: Actor
  ): Promise<MemoryDocument> {
    const changed = await this.sql.run(
      `UPDATE ai_memory SET content = ?, revision = revision + 1, updated_at = ?, updated_by = ?
       WHERE path = ? AND revision = ?`,
      content,
      Date.now(),
      this.author(actor),
      current.path,
      current.revision
    )

    if (changed !== 1) {
      throw new ConcurrentWrite()
    }

    await this.keep(current.path, current.revision + 1, content, action, actor)
    return this.require(current.path)
  }

  private author(actor: Actor): string {
    return actor.by === 'segretario' ? (actor.runId ?? 'segretario') : actor.by
  }

  private async keep(
    path: string,
    revision: number,
    content: string | null,
    action: string,
    actor: Actor
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO ai_memory_history (path, revision, content, action, actor, run_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      path,
      revision,
      content,
      action,
      actor.by,
      actor.runId ?? null,
      Date.now()
    )
    await this.sql.run(
      `DELETE FROM ai_memory_history WHERE path = ? AND id NOT IN (
         SELECT id FROM ai_memory_history WHERE path = ? ORDER BY id DESC LIMIT ?
       )`,
      path,
      path,
      VERSIONS_KEPT
    )
  }
}

/** Another writer got there first: the caller applies its change again on what is there now. */
class ConcurrentWrite extends Error {
  constructor() {
    super('concurrent write')
  }
}
