import extensionMain from '@app/extension/main'

import system from './prompts/segretario.md?raw'
import context from './prompts/contesto.md?raw'
import taskReading from './prompts/compiti/lettura.md?raw'
import taskDay from './prompts/compiti/giornata.md?raw'
import taskProjectState from './prompts/compiti/punto.md?raw'
import taskCalendar from './prompts/compiti/calendario.md?raw'
import taskRequest from './prompts/compiti/richiesta.md?raw'
import taskWriting from './prompts/compiti/scrittura.md?raw'
import taskReview from './prompts/compiti/revisione.md?raw'
import taskSearch from './prompts/compiti/ricerca.md?raw'
import taskGettingToKnow from './prompts/compiti/conoscimi.md?raw'
import taskReflection from './prompts/compiti/riflessione.md?raw'
import taskKeepingUp from './prompts/compiti/al-passo.md?raw'
import compaction from './prompts/infrastruttura/compattazione.md?raw'
import title from './prompts/infrastruttura/titolo.md?raw'
import toolSearchMail from './prompts/strumenti/cerca_posta.md?raw'
import toolSearchFiles from './prompts/strumenti/cerca_file.md?raw'
import toolRead from './prompts/strumenti/leggi.md?raw'
import toolNote from './prompts/strumenti/nota.md?raw'
import toolCommitments from './prompts/strumenti/impegni.md?raw'
import toolProjects from './prompts/strumenti/progetti.md?raw'
import toolReply from './prompts/strumenti/risposta.md?raw'
import toolWriteDraft from './prompts/strumenti/scrivi_bozza.md?raw'
import toolSendDraft from './prompts/strumenti/invia_bozza.md?raw'
import toolOrganize from './prompts/strumenti/organizza.md?raw'
import toolCalendar from './prompts/strumenti/calendario.md?raw'
import toolMemory from './prompts/strumenti/memoria.md?raw'
import toolToday from './prompts/strumenti/oggi.md?raw'
import toolReview from './prompts/strumenti/revisione.md?raw'
import toolShow from './prompts/strumenti/mostra.md?raw'
import toolJournal from './prompts/strumenti/diario.md?raw'

import type { TaskKind } from './agent/tool-types'

/**
 * The Segretario's words: every prompt is a text file next to this one,
 * in Italian, edited as text — they are what makes the Segretario what it
 * is. They are part of the build (`?raw`), not read from disk at runtime.
 *
 * One identity (`segretario.md`) for every run, a task for each moment it
 * is woken in (`compiti/`), a description for each tool (`strumenti/`);
 * the technical chores that are not the Segretario apart (`infrastruttura/`).
 */
export const PROMPTS = {
  system: system.trim(),
  context: context.trim(),
  tasks: {
    lettura: taskReading.trim(),
    giornata: taskDay.trim(),
    punto: taskProjectState.trim(),
    calendario: taskCalendar.trim(),
    richiesta: taskRequest.trim(),
    scrittura: taskWriting.trim(),
    revisione: taskReview.trim(),
    ricerca: taskSearch.trim(),
    conoscimi: taskGettingToKnow.trim(),
    riflessione: taskReflection.trim(),
    al_passo: taskKeepingUp.trim()
  } satisfies Record<TaskKind, string>,
  compaction: compaction.trim(),
  title: title.trim(),
  tools: {
    cerca_posta: toolSearchMail.trim(),
    cerca_file: toolSearchFiles.trim(),
    leggi: toolRead.trim(),
    nota: toolNote.trim(),
    impegni: toolCommitments.trim(),
    progetti: toolProjects.trim(),
    risposta: toolReply.trim(),
    scrivi_bozza: toolWriteDraft.trim(),
    invia_bozza: toolSendDraft.trim(),
    organizza: toolOrganize.trim(),
    calendario: toolCalendar.trim(),
    memoria: toolMemory.trim(),
    oggi: toolToday.trim(),
    revisione: toolReview.trim(),
    mostra: toolShow.trim(),
    diario: toolJournal.trim()
  }
} as const

/**
 * The Segretario's identity, with what the extension says of the company
 * the build is for: the same for every run, so the prefix the provider
 * caches is shared by all of them — read when a run starts, since it may
 * name what the user configured.
 */
export async function systemPrompt(): Promise<string> {
  const company = (await extensionMain.assistant?.instructions?.())?.trim()
  return company ? `${PROMPTS.system}\n\n${company}` : PROMPTS.system
}

/** Fills `{{name}}` in a prompt template; a name not given is left out. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '').trim()
}
