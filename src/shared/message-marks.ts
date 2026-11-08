/**
 * A mark an extension left on a message: a fact of what it did with it,
 * outside the mail — "Archiviato in Acme", "Protocollato" — and, when it
 * has one, where. It follows the message wherever it goes, and shows on
 * its row and in the reader, with the AI off too; the Segretario reads it
 * with the message (vision §6.3).
 */
export interface MessageMark {
  accountId: string
  messageKey: string
  /** The extension that left it: its id. */
  extension: string
  /** What it says, in the extension's words. */
  label: string
  /** Where what it did is — a folder, as the app keeps paths —, or null. */
  place: string | null
  /** The files it wrote there. */
  files: string[]
  markedAt: number
}

/**
 * Where earlier mail of the selected conversations — or, for a new one, of
 * the same sender, which `from` says — was marked with a place: the latest.
 */
export interface MarkedBefore {
  place: string
  from: 'conversazione' | 'mittente'
}

/** Marks changed on these messages of an account: their rows and the reader ask again. */
export interface MessageMarksChange {
  accountId: string
  messageKeys: string[]
}
