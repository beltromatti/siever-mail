import { useState } from 'react'
import { ChevronDown, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'

import { cn } from '@renderer/lib/utils'
import type { MailMessageDetail, MessageRef, PecReceipt } from '@shared/models'
import { isPecFailure, pecReceiptAt, pecReceiptWords } from '@shared/pec'

const MOMENT = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

function moment(iso: string | null | undefined): string | null {
  return iso ? MOMENT.format(new Date(iso)) : null
}

/**
 * Certified mail (PEC) as the reader shows it, above the message: who
 * certified a message that came in the provider's envelope, and when — the
 * envelope itself a click away; an anomaly, said as such; what a receipt
 * says, with the message sent it is about; and, on a message the user sent
 * from a certified mailbox, where it stands — accepted, delivered to whom,
 * or not. Nothing for any other message.
 */
export function PecPanel({
  message,
  onOpen
}: {
  message: MailMessageDetail
  onOpen: (ref: MessageRef) => void
}): React.JSX.Element | null {
  const [envelopeOpen, setEnvelopeOpen] = useState(false)
  const detail = message.pecDetail
  const certification = detail?.certification ?? null

  if (message.pec?.kind === 'busta') {
    const by = certification?.provider ? ` da ${certification.provider}` : ''
    const at = moment(certification?.at)

    return (
      <div className="bg-hover/60 mb-3 rounded-md border px-3 py-2 text-[12px]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Posta certificata</span>
            <span className="text-muted-foreground">
              {` · certificata${by}${at ? ` ${at}` : ''}`}
            </span>
          </span>
          {(detail?.envelopeText || certification) && (
            <button
              type="button"
              onClick={() => setEnvelopeOpen((open) => !open)}
              aria-expanded={envelopeOpen}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 inline-flex shrink-0 items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2"
            >
              Busta del gestore
              <ChevronDown
                className={cn('size-3 transition-transform', envelopeOpen && 'rotate-180')}
              />
            </button>
          )}
        </div>
        {envelopeOpen && (
          <div className="text-muted-foreground mt-2 space-y-1.5 border-t pt-2">
            {certification && (
              <p>
                {certification.recipients.length > 0 &&
                  `Destinatari: ${certification.recipients
                    .map(
                      (recipient) =>
                        `${recipient.address}${recipient.certified ? '' : ' (posta ordinaria)'}`
                    )
                    .join(', ')}. `}
                {certification.id && `Identificativo: ${certification.id}`}
              </p>
            )}
            {detail?.envelopeText && (
              <pre className="font-sans text-[11.5px] whitespace-pre-wrap">
                {detail.envelopeText}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  if (message.pec?.kind === 'anomalia') {
    return (
      <div className="bg-warning/10 mb-3 flex items-start gap-2 rounded-md border border-[hsl(var(--warning)/0.3)] px-3 py-2 text-[12px]">
        <ShieldAlert className="text-warning mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-semibold">Anomalia PEC.</span>{' '}
          <span className="text-muted-foreground">
            Il gestore non ha potuto certificare questo messaggio: viene da una casella non PEC, o è
            stato alterato. Ha il valore di una mail ordinaria.
          </span>
        </span>
      </div>
    )
  }

  if (message.pec) {
    const failed = isPecFailure(message.pec.kind)
    const at = moment(certification?.at ?? message.date)

    return (
      <div
        className={cn(
          'mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]',
          failed ? 'bg-destructive/10 border-[hsl(var(--destructive)/0.3)]' : 'bg-hover/60'
        )}
      >
        {failed ? (
          <ShieldX className="text-destructive-soft-foreground size-3.5 shrink-0" />
        ) : (
          <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn('font-semibold', failed && 'text-destructive-soft-foreground')}>
            Ricevuta PEC · {pecReceiptWords(message.pec.kind, certification)}
          </span>
          {at && <span className="text-muted-foreground">{` · ${at}`}</span>}
        </span>
        {message.pecSent && (
          <button
            type="button"
            onClick={() => onOpen(message.pecSent!)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 shrink-0 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2"
          >
            Il messaggio inviato
          </button>
        )}
      </div>
    )
  }

  if (message.pecReceipts && message.pecReceipts.length > 0) {
    return <SentState receipts={message.pecReceipts} onOpen={onOpen} />
  }

  return null
}

/** Where a certified message the user sent stands: its receipts, each to open. */
function SentState({
  receipts,
  onOpen
}: {
  receipts: ReadonlyArray<PecReceipt>
  onOpen: (ref: MessageRef) => void
}): React.JSX.Element {
  const failed = receipts.some((receipt) => isPecFailure(receipt.kind))

  return (
    <div
      className={cn(
        'mb-3 rounded-md border px-3 py-2 text-[12px]',
        failed ? 'bg-destructive/10 border-[hsl(var(--destructive)/0.3)]' : 'bg-hover/60'
      )}
    >
      <p className="mb-1 flex items-center gap-2 font-semibold">
        {failed ? (
          <ShieldX className="text-destructive-soft-foreground size-3.5 shrink-0" />
        ) : (
          <ShieldCheck className="text-muted-foreground size-3.5 shrink-0" />
        )}
        Inviata con la PEC
      </p>
      <ul className="space-y-0.5 pl-[22px]">
        {receipts.map((receipt) => (
          <li key={`${receipt.ref.folderPath}:${receipt.ref.uid}`}>
            <button
              type="button"
              onClick={() => onOpen(receipt.ref)}
              className={cn(
                'focus-visible:ring-ring/60 rounded-sm text-left underline-offset-2 outline-none hover:underline focus-visible:ring-2',
                isPecFailure(receipt.kind)
                  ? 'text-destructive-soft-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {pecReceiptWords(receipt.kind, receipt.certification)} ·{' '}
              {moment(pecReceiptAt(receipt))}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
