import { defineMessages, messagesIn, type Language } from './i18n'
import type { PecCertification, PecKind, PecReceipt } from './models'

/** What each of the provider's receipts says of the message sent, in a word, and the rest of a certified message's words. */
const PEC_WORDS = defineMessages({
  accettazione: { en: 'Accepted', it: 'Accettata', de: 'Angenommen' },
  'non-accettazione': { en: 'Not accepted', it: 'Non accettata', de: 'Nicht angenommen' },
  'presa-in-carico': { en: 'Taken in charge', it: 'Presa in carico', de: 'Übernommen' },
  'avvenuta-consegna': { en: 'Delivered', it: 'Consegnata', de: 'Zugestellt' },
  'errore-consegna': { en: 'Not delivered', it: 'Non consegnata', de: 'Nicht zugestellt' },
  'preavviso-errore-consegna': {
    en: 'Not delivered yet',
    it: 'Non ancora consegnata',
    de: 'Noch nicht zugestellt'
  },
  'rilevazione-virus': { en: 'Virus detected', it: 'Virus rilevato', de: 'Virus erkannt' },
  envelope: { en: 'PEC', it: 'PEC', de: 'PEC' },
  anomaly: { en: 'PEC · anomaly', it: 'PEC · anomalia', de: 'PEC · Anomalie' },
  deliveredTo: {
    en: (address: string) => ` to ${address}`,
    it: (address: string) => ` a ${address}`,
    de: (address: string) => ` an ${address}`
  }
}) satisfies Record<Exclude<PecKind, 'busta' | 'anomalia'>, unknown>

/** Whether a certified message is a receipt on a message sent, not a message carried. */
export function isPecReceiptKind(kind: PecKind): kind is Exclude<PecKind, 'busta' | 'anomalia'> {
  return kind !== 'busta' && kind !== 'anomalia'
}

/** Whether a receipt says the message sent did not get where it was going. */
export function isPecFailure(kind: PecKind): boolean {
  return (
    kind === 'non-accettazione' ||
    kind === 'errore-consegna' ||
    kind === 'preavviso-errore-consegna' ||
    kind === 'rilevazione-virus'
  )
}

/**
 * A certified message in a word, as its row and the reader show it, in
 * `language`: "PEC", "Delivered"… The Segretario reads it in Italian.
 */
export function pecLabel(kind: PecKind, language: Language): string {
  const words = messagesIn(PEC_WORDS, language)
  return kind === 'busta' ? words.envelope : kind === 'anomalia' ? words.anomaly : words[kind]
}

/** What a receipt says, in words, in `language`: "Delivered to ufficio@pec.it", "Not delivered to … — mailbox full". */
export function pecReceiptWords(
  kind: PecKind,
  certification: PecCertification | null,
  language: Language
): string {
  const words = pecLabel(kind, language)
  const to = certification?.delivery
    ? messagesIn(PEC_WORDS, language).deliveredTo(certification.delivery)
    : ''
  const why =
    isPecFailure(kind) && certification?.errorDetail ? ` — ${certification.errorDetail}` : ''
  return `${words}${to}${why}`
}

/** When a receipt certifies what it says: the provider's moment, or when it came. */
export function pecReceiptAt(receipt: PecReceipt): string {
  return receipt.certification?.at ?? receipt.date
}
