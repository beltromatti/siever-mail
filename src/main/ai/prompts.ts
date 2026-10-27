import extensionMain from '@app/extension/main'

import compaction from './prompts/compattazione.md?raw'
import learning from './prompts/conoscerti.md?raw'
import briefing from './prompts/oggi.md?raw'
import context from './prompts/contesto.md?raw'
import reflection from './prompts/riflessione.md?raw'
import triage from './prompts/smistamento.md?raw'
import readyDraft from './prompts/risposta-pronta.md?raw'
import system from './prompts/segretario.md?raw'
import searchFiles from './prompts/strumenti/cerca_file.md?raw'
import searchMail from './prompts/strumenti/cerca_posta.md?raw'
import sendDraft from './prompts/strumenti/invia_bozza.md?raw'
import readAttachment from './prompts/strumenti/leggi_allegato.md?raw'
import readFile from './prompts/strumenti/leggi_file.md?raw'
import readMail from './prompts/strumenti/leggi_posta.md?raw'
import memory from './prompts/strumenti/memoria.md?raw'
import show from './prompts/strumenti/mostra.md?raw'
import organize from './prompts/strumenti/organizza.md?raw'
import overview from './prompts/strumenti/panoramica.md?raw'
import writeDraft from './prompts/strumenti/scrivi_bozza.md?raw'
import title from './prompts/titolo.md?raw'

/**
 * The Segretario's words: every prompt is a text file next to this one,
 * in Italian, edited as text — they are what makes the Segretario what it
 * is. They are part of the build (`?raw`), not read from disk at runtime.
 *
 * An extension adds its own (see `ExtensionMain.assistant`): its text joins
 * the system prompt after the host's.
 */
export const PROMPTS = {
  system: [system.trim(), extensionMain.assistant?.systemPrompt?.trim()]
    .filter(Boolean)
    .join('\n\n'),
  context: context.trim(),
  compaction: compaction.trim(),
  briefing: briefing.trim(),
  learning: learning.trim(),
  reflection: reflection.trim(),
  triage: triage.trim(),
  readyDraft: readyDraft.trim(),
  title: title.trim(),
  tools: {
    cerca_posta: searchMail.trim(),
    panoramica: overview.trim(),
    leggi_posta: readMail.trim(),
    leggi_allegato: readAttachment.trim(),
    cerca_file: searchFiles.trim(),
    leggi_file: readFile.trim(),
    scrivi_bozza: writeDraft.trim(),
    invia_bozza: sendDraft.trim(),
    organizza: organize.trim(),
    memoria: memory.trim(),
    mostra: show.trim()
  }
} as const

/** Fills `{{name}}` in a prompt template; a name not given is left out. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '').trim()
}
