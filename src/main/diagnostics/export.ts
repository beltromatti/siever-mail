import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'

import { Zip, ZipDeflate } from 'fflate'

import type { DiagnosticsExportOptions } from '@shared/diagnostics'

import { diagnosticsFiles, diagnosticsSession, localDay, withoutSecrets } from './log'
import { SummaryCounter } from './summary'

/** A file of the export: its path inside the archive, and what it holds. */
export interface BundleFile {
  name: string
  /** Text as it is; anything else as indented JSON. */
  content: unknown
}

/** Where the export takes what it holds besides the log. */
export interface DiagnosticsBundleSource {
  /** What each part of the app says of itself (`diagnosticState`). */
  state(): Promise<Record<string, unknown>>
  /** The Segretario's work in full, from a moment on — only when the user includes it. */
  segretario(sinceMs: number): AsyncIterable<BundleFile>
  /** What the installed extension adds, under its own folder. */
  extension(sinceMs: number): Promise<BundleFile[]>
  about: { version: string; edition: string }
}

const CHUNK_BYTES = 256 * 1024

/** What the archive holds, in words, written once it is known: its first file to open. */
function readme(
  options: DiagnosticsExportOptions,
  about: DiagnosticsBundleSource['about'],
  held: { sessions: number; extension: boolean }
): string {
  return [
    `Diagnostica di SIEVER Mail ${about.version} (${about.edition})`,
    `Creata il ${new Date().toLocaleString('it-IT')} su questo computer: non è stata mandata a nessuno.`,
    '',
    'Che cosa contiene',
    '',
    '- manifesto.json: che cosa c’è in questo archivio, con il periodo e le scelte fatte.',
    '- stato.json: com’era SIEVER Mail al momento dell’esportazione: la versione, il sistema, le connessioni (posta, calendari) con i loro indirizzi, il Segretario, l’estensione.',
    '- riepilogo.json: il registro a colpo d’occhio: gli avvii, quanto tempo la finestra è stata in primo piano ogni giorno, quante volte è successa ogni cosa, gli errori e gli avvisi raggruppati, le esecuzioni del Segretario per compito, come l’utente ha risposto al suo lavoro, ciò che è stato lento.',
    `- registro/: il registro ${options.days === 1 ? 'dell’ultimo giorno' : `degli ultimi ${options.days} giorni`}, un evento per riga (JSON): gli errori, lo stato delle connessioni, ciò che si fa nell’app, il lavoro del Segretario. Ogni riga ha l’ora (t), l’avvio (s), il livello (lvl), la parte dell’app (area) e che cosa è successo (ev); "by" è chi l’ha fatto, "run" l’esecuzione del Segretario, "conn" la connessione, "ms" quanto è durato.`,
    ...(options.segretario
      ? [
          `- segretario/sessioni/: ${held.sessions === 1 ? 'l’esecuzione' : `le ${held.sessions} esecuzioni`} del Segretario nel periodo, per intero — ciò che ha ricevuto, ciò che ha pensato, gli strumenti che ha usato e ciò che ne è uscito —, una per file, con lo stesso identificativo ("run") del registro. Contengono il testo delle mail, degli eventi e dei file che ha letto.`,
          '- segretario/memoria/: le note della sua memoria, com’erano al momento.',
          '- segretario/coda.json e lezioni.json: il lavoro in coda o fallito, e ciò che deve ancora imparare.'
        ]
      : [
          '- Il lavoro del Segretario per intero non c’è: all’esportazione si è scelto di lasciarlo fuori.'
        ]),
    ...(held.extension ? ['- estensione/: ciò che l’estensione installata aggiunge.'] : []),
    '',
    'Che cosa non contiene: password, chiavi, token di accesso; il contenuto della posta, delle ricerche e delle note, fuori dalle sessioni del Segretario.'
  ].join('\n')
}

/**
 * Writes the export (vision §14.4) to `target`, through a file beside it
 * renamed at the end: an export cut short leaves no broken archive. Nothing
 * is held whole: the log is read a piece at a time — counted for the
 * summary as it goes — and every part compressed a chunk at a time, waiting
 * for the disk when it lags and letting the app breathe in between.
 * Returns its size in bytes.
 */
export async function writeDiagnosticsBundle(
  target: string,
  options: DiagnosticsExportOptions,
  source: DiagnosticsBundleSource
): Promise<number> {
  const partial = `${target}.part`
  const out = createWriteStream(partial)
  let written = 0
  let failed: Error | null = null
  const closed = new Promise<void>((resolve, reject) => {
    out.on('error', (error) => {
      failed ??= error
      reject(error)
    })
    out.on('close', resolve)
  })
  // Heard from the start: a disk that refuses a write stops the export where it is.
  closed.catch(() => undefined)
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      failed ??= error
      out.destroy(error)
      return
    }

    if (out.destroyed) {
      return
    }

    written += chunk.length
    out.write(chunk)

    if (final) {
      out.end()
    }
  })
  const listed: Array<{ name: string; bytes: number }> = []
  /** Between two chunks: the disk catches up, and the app breathes. */
  const pause = async (): Promise<void> => {
    if (failed) {
      throw failed
    }

    if (out.writableNeedDrain) {
      await once(out, 'drain')
    }

    await new Promise((resolve) => setImmediate(resolve))
  }
  const entry = (name: string): ZipDeflate => {
    if (failed) {
      throw failed
    }

    const deflate = new ZipDeflate(name, { level: 6 })
    zip.add(deflate)
    return deflate
  }
  const add = async (file: BundleFile): Promise<void> => {
    const text =
      typeof file.content === 'string' ? file.content : JSON.stringify(file.content, null, 2)
    const data = new TextEncoder().encode(text)
    const deflate = entry(file.name)
    let at = 0

    do {
      const end = Math.min(at + CHUNK_BYTES, data.length)
      deflate.push(data.subarray(at, end), end === data.length)
      at = end
      await pause()
    } while (at < data.length)

    listed.push({ name: file.name, bytes: data.length })
  }
  /** A file of the log, as it is on disk, each of its lines handed over as it passes. */
  const addLog = async (
    name: string,
    path: string,
    onLine: (line: string) => void
  ): Promise<void> => {
    const deflate = entry(name)
    const decoder = new TextDecoder()
    let rest = ''
    let bytes = 0

    for await (const chunk of createReadStream(path, { highWaterMark: CHUNK_BYTES })) {
      const data = chunk as Buffer
      bytes += data.length
      deflate.push(new Uint8Array(data), false)
      const lines = (rest + decoder.decode(data, { stream: true })).split('\n')
      rest = lines.pop() ?? ''
      lines.forEach(onLine)
      await pause()
    }

    onLine(rest + decoder.decode())
    deflate.push(new Uint8Array(0), true)
    listed.push({ name, bytes })
  }

  try {
    const sinceMs = Date.now() - options.days * 24 * 60 * 60 * 1000
    const summary = new SummaryCounter()

    await add({ name: 'stato.json', content: withoutSecrets(await source.state()) })

    for (const file of diagnosticsFiles(localDay(new Date(sinceMs)))) {
      await addLog(`registro/${file.name}`, file.path, (line) => summary.add(line))
    }

    await add({ name: 'riepilogo.json', content: summary.result() })
    let sessions = 0

    if (options.segretario) {
      for await (const file of source.segretario(sinceMs)) {
        sessions += file.name.startsWith('sessioni/') ? 1 : 0
        await add({ name: `segretario/${file.name}`, content: file.content })
      }
    }

    const extensionFiles = await source.extension(sinceMs)

    for (const file of extensionFiles) {
      await add({
        name: `estensione/${file.name}`,
        content: typeof file.content === 'string' ? file.content : withoutSecrets(file.content)
      })
    }

    await add({
      name: 'LEGGIMI.txt',
      content: readme(options, source.about, { sessions, extension: extensionFiles.length > 0 })
    })
    await add({
      name: 'manifesto.json',
      content: {
        app: 'SIEVER Mail',
        ...source.about,
        createdAt: new Date().toISOString(),
        session: diagnosticsSession(),
        options,
        since: new Date(sinceMs).toISOString(),
        files: listed
      }
    })
    zip.end()
    await closed

    if (failed) {
      throw failed
    }

    await rename(partial, target)
    return written
  } catch (error) {
    // What was still being written ends before the file goes: nothing is left half there.
    zip.terminate()
    out.destroy()
    await closed.catch(() => undefined)
    await rm(partial, { force: true })
    throw error
  }
}
