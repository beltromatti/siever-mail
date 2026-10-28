import extensionMain from '@app/extension/main'

import compaction from './prompts/compattazione.md?raw'
import topicState from './prompts/argomento.md?raw'
import followUp from './prompts/sollecito.md?raw'
import review from './prompts/revisione.md?raw'
import topicGist from './prompts/argomento-in-breve.md?raw'
import learning from './prompts/conoscerti.md?raw'
import briefing from './prompts/oggi.md?raw'
import context from './prompts/contesto.md?raw'
import reflection from './prompts/riflessione.md?raw'
import writing from './prompts/scrittura.md?raw'
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
import topicsTool from './prompts/strumenti/argomenti.md?raw'
import commitmentsTool from './prompts/strumenti/impegni.md?raw'
import calendarTool from './prompts/strumenti/calendario.md?raw'
import writeDraft from './prompts/strumenti/scrivi_bozza.md?raw'
import title from './prompts/titolo.md?raw'

/**
 * The Segretario's words: every prompt is a text file next to this one,
 * in Italian, edited as text — they are what makes the Segretario what it
 * is. They are part of the build (`?raw`), not read from disk at runtime.
 *
 * An extension adds its own (see `ExtensionMain.assistant`): what it says
 * of the company joins, after the host's text, every prompt that reads the
 * user's mail to judge or write it.
 */
const company = extensionMain.assistant?.systemPrompt?.trim()

function withCompany(prompt: string): string {
  return company ? `${prompt.trim()}\n\n${company}` : prompt.trim()
}

export const PROMPTS = {
  system: withCompany(system),
  context: context.trim(),
  compaction: compaction.trim(),
  topicState: withCompany(topicState),
  topicGist: withCompany(topicGist),
  briefing: withCompany(briefing),
  learning: learning.trim(),
  reflection: reflection.trim(),
  triage: withCompany(triage),
  writing: withCompany(writing),
  readyDraft: withCompany(readyDraft),
  followUp: withCompany(followUp),
  review: review.trim(),
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
    argomenti: topicsTool.trim(),
    impegni: commitmentsTool.trim(),
    calendario: calendarTool.trim(),
    mostra: show.trim()
  }
} as const

/** Fills `{{name}}` in a prompt template; a name not given is left out. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '').trim()
}
