import { clip } from './tools/format'

/**
 * What the model reads to reread a message: the moment, the message as it
 * will go, and the one it answers — named, for the run to read if it needs.
 */
export function reviewRequest(input: {
  now: string
  from: string
  to: ReadonlyArray<string>
  cc: ReadonlyArray<string>
  subject: string
  attachments: ReadonlyArray<string>
  writtenText: string
  answered: { handle: string; from: string; date: string; subject: string } | null
}): string {
  return [
    input.now,
    [
      '## Il messaggio che sta per partire',
      '',
      `Da: ${input.from}`,
      `A: ${input.to.join(', ') || '(nessuno)'}`,
      input.cc.length > 0 ? `Cc: ${input.cc.join(', ')}` : null,
      `Oggetto: ${input.subject || '(nessuno)'}`,
      `Allegati: ${input.attachments.join(', ') || 'nessuno'}`,
      '',
      clip(input.writtenText.trim() || '(nessun testo)', 8000).text
    ]
      .filter((line) => line !== null)
      .join('\n'),
    input.answered
      ? `Risponde a ${input.answered.handle} · ${input.answered.date} · da ${input.answered.from} · «${input.answered.subject}».`
      : null
  ]
    .filter(Boolean)
    .join('\n\n')
}
