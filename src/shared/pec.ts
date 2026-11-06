import type { PecCertification, PecKind, PecReceipt } from './models'

/** What each of the provider's receipts says of the message sent, in a word. */
const RECEIPT_WORDS: Readonly<Record<Exclude<PecKind, 'busta' | 'anomalia'>, string>> = {
  accettazione: 'Accettata',
  'non-accettazione': 'Non accettata',
  'presa-in-carico': 'Presa in carico',
  'avvenuta-consegna': 'Consegnata',
  'errore-consegna': 'Non consegnata',
  'preavviso-errore-consegna': 'Non ancora consegnata',
  'rilevazione-virus': 'Virus rilevato'
}

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

/** A certified message in a word, as its row and the reader show it: "PEC", "Consegnata"… */
export function pecLabel(kind: PecKind): string {
  return kind === 'busta' ? 'PEC' : kind === 'anomalia' ? 'PEC · anomalia' : RECEIPT_WORDS[kind]
}

/** What a receipt says, in words: "Consegnata a ufficio@pec.it", "Non consegnata a … — casella piena". */
export function pecReceiptWords(kind: PecKind, certification: PecCertification | null): string {
  const words = isPecReceiptKind(kind) ? RECEIPT_WORDS[kind] : pecLabel(kind)
  const to = certification?.delivery ? ` a ${certification.delivery}` : ''
  const why =
    isPecFailure(kind) && certification?.errorDetail ? ` — ${certification.errorDetail}` : ''
  return `${words}${to}${why}`
}

/** When a receipt certifies what it says: the provider's moment, or when it came. */
export function pecReceiptAt(receipt: PecReceipt): string {
  return receipt.certification?.at ?? receipt.date
}
