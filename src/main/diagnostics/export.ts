import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'

import { Zip, ZipDeflate } from 'fflate'

import { languageState, messages } from '@main/i18n'
import type { DiagnosticsExportOptions } from '@shared/diagnostics'
import { defineMessages } from '@shared/i18n'

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

const README = defineMessages({
  fileName: { en: 'README.txt', it: 'LEGGIMI.txt', de: 'LIESMICH.txt' },
  title: {
    en: (version: string, edition: string) => `SIEVER Mail diagnostics ${version} (${edition})`,
    it: (version: string, edition: string) => `Diagnostica di SIEVER Mail ${version} (${edition})`,
    de: (version: string, edition: string) => `Diagnose von SIEVER Mail ${version} (${edition})`
  },
  created: {
    en: (when: string) => `Created on ${when} on this computer: it hasn’t been sent to anyone.`,
    it: (when: string) => `Creata il ${when} su questo computer: non è stata mandata a nessuno.`,
    de: (when: string) =>
      `Erstellt am ${when} auf diesem Computer: Sie wurde an niemanden gesendet.`
  },
  contains: { en: 'What it contains', it: 'Che cosa contiene', de: 'Was sie enthält' },
  manifest: {
    en: '- manifesto.json: what this archive holds, with the period and the choices made.',
    it: '- manifesto.json: che cosa c’è in questo archivio, con il periodo e le scelte fatte.',
    de: '- manifesto.json: was dieses Archiv enthält, mit dem Zeitraum und den getroffenen Einstellungen.'
  },
  state: {
    en: '- stato.json: how SIEVER Mail was at the time of the export: the version, the system, the connections (mail, calendars) with their addresses, the Segretario, the extension.',
    it: '- stato.json: com’era SIEVER Mail al momento dell’esportazione: la versione, il sistema, le connessioni (posta, calendari) con i loro indirizzi, il Segretario, l’estensione.',
    de: '- stato.json: der Zustand von SIEVER Mail zum Zeitpunkt des Exports: die Version, das System, die Verbindungen (E-Mail, Kalender) mit ihren Adressen, der Segretario, die Erweiterung.'
  },
  summary: {
    en: '- riepilogo.json: the log at a glance: the launches, how long the window was in front each day, how many times each thing happened, the errors and warnings grouped, the Segretario’s runs by task, how the user responded to its work, the notifications by type (shown, opened, dismissed), what was slow.',
    it: '- riepilogo.json: il registro a colpo d’occhio: gli avvii, quanto tempo la finestra è stata in primo piano ogni giorno, quante volte è successa ogni cosa, gli errori e gli avvisi raggruppati, le esecuzioni del Segretario per compito, come l’utente ha risposto al suo lavoro, le notifiche per tipo (mostrate, aperte, scartate), ciò che è stato lento.',
    de: '- riepilogo.json: das Protokoll auf einen Blick: die Starts, wie lange das Fenster jeden Tag im Vordergrund war, wie oft jedes Ereignis vorkam, die Fehler und Warnungen gruppiert, die Ausführungen des Segretario nach Aufgabe, wie der Benutzer auf seine Arbeit reagiert hat, die Benachrichtigungen nach Art (angezeigt, geöffnet, verworfen), was langsam war.'
  },
  log: {
    en: (days: number) =>
      `- registro/: the log ${days === 1 ? 'of the last day' : `of the last ${days} days`}, one event per line (JSON): the errors, the state of the connections, what is done in the app, the Segretario’s work. Each line has the time (t), the launch (s), the level (lvl), the part of the app (area) and what happened (ev); "by" is who did it, "run" the Segretario’s run, "conn" the connection, "ms" how long it took.`,
    it: (days: number) =>
      `- registro/: il registro ${days === 1 ? 'dell’ultimo giorno' : `degli ultimi ${days} giorni`}, un evento per riga (JSON): gli errori, lo stato delle connessioni, ciò che si fa nell’app, il lavoro del Segretario. Ogni riga ha l’ora (t), l’avvio (s), il livello (lvl), la parte dell’app (area) e che cosa è successo (ev); "by" è chi l’ha fatto, "run" l’esecuzione del Segretario, "conn" la connessione, "ms" quanto è durato.`,
    de: (days: number) =>
      `- registro/: das Protokoll ${days === 1 ? 'des letzten Tages' : `der letzten ${days} Tage`}, ein Ereignis pro Zeile (JSON): die Fehler, der Zustand der Verbindungen, was in der App getan wird, die Arbeit des Segretario. Jede Zeile hat die Uhrzeit (t), den Start (s), die Stufe (lvl), den Teil der App (area) und was geschehen ist (ev); "by" ist, wer es getan hat, "run" die Ausführung des Segretario, "conn" die Verbindung, "ms" wie lange es gedauert hat.`
  },
  sessions: {
    en: (count: number) =>
      `- segretario/sessioni/: ${count === 1 ? 'the Segretario’s run' : `the Segretario’s ${count} runs`} in the period, in full — what it received, what it thought, the tools it used and what came of them —, one per file, with the same identifier ("run") as the log. They contain the text of the emails, events and files it read.`,
    it: (count: number) =>
      `- segretario/sessioni/: ${count === 1 ? 'l’esecuzione' : `le ${count} esecuzioni`} del Segretario nel periodo, per intero — ciò che ha ricevuto, ciò che ha pensato, gli strumenti che ha usato e ciò che ne è uscito —, una per file, con lo stesso identificativo ("run") del registro. Contengono il testo delle mail, degli eventi e dei file che ha letto.`,
    de: (count: number) =>
      `- segretario/sessioni/: ${count === 1 ? 'die Ausführung' : `die ${count} Ausführungen`} des Segretario im Zeitraum, vollständig — was er erhalten und gedacht hat, welche Werkzeuge er benutzt hat und was dabei herauskam —, eine pro Datei, mit derselben Kennung ("run") wie im Protokoll. Sie enthalten den Text der E-Mails, Termine und Dateien, die er gelesen hat.`
  },
  memory: {
    en: '- segretario/memoria/: the notes of its memory, as they were at the time.',
    it: '- segretario/memoria/: le note della sua memoria, com’erano al momento.',
    de: '- segretario/memoria/: die Notizen seines Gedächtnisses, wie sie zu diesem Zeitpunkt waren.'
  },
  queue: {
    en: '- segretario/coda.json and lezioni.json: the work queued or failed, and what it still has to learn.',
    it: '- segretario/coda.json e lezioni.json: il lavoro in coda o fallito, e ciò che deve ancora imparare.',
    de: '- segretario/coda.json und lezioni.json: die anstehende oder fehlgeschlagene Arbeit und was er noch lernen muss.'
  },
  segretarioLeftOut: {
    en: '- The Segretario’s work in full isn’t here: it was left out when exporting.',
    it: '- Il lavoro del Segretario per intero non c’è: all’esportazione si è scelto di lasciarlo fuori.',
    de: '- Die vollständige Arbeit des Segretario ist nicht enthalten: Sie wurde beim Export weggelassen.'
  },
  extension: {
    en: '- estensione/: what the installed extension adds.',
    it: '- estensione/: ciò che l’estensione installata aggiunge.',
    de: '- estensione/: was die installierte Erweiterung hinzufügt.'
  },
  notContained: {
    en: 'What it doesn’t contain: passwords, keys, access tokens; the content of the mail, the searches and the notes, outside the Segretario’s sessions.',
    it: 'Che cosa non contiene: password, chiavi, token di accesso; il contenuto della posta, delle ricerche e delle note, fuori dalle sessioni del Segretario.',
    de: 'Nicht enthalten: Passwörter, Schlüssel, Zugriffstoken; der Inhalt der E-Mails, der Suchen und der Notizen, außerhalb der Sitzungen des Segretario.'
  }
})

/** What the archive holds, in words, written once it is known: its first file to open. */
function readme(
  options: DiagnosticsExportOptions,
  about: DiagnosticsBundleSource['about'],
  held: { sessions: number; extension: boolean }
): string {
  const m = messages(README)

  return [
    m.title(about.version, about.edition),
    m.created(new Date().toLocaleString(languageState().formatLocale)),
    '',
    m.contains,
    '',
    m.manifest,
    m.state,
    m.summary,
    m.log(options.days),
    ...(options.segretario
      ? [m.sessions(held.sessions), m.memory, m.queue]
      : [m.segretarioLeftOut]),
    ...(held.extension ? [m.extension] : []),
    '',
    m.notContained
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
      name: messages(README).fileName,
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
