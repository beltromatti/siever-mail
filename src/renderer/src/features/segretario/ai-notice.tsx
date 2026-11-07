import { useEffect, useState } from 'react'

import { ConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import {
  noticeWords,
  OPENROUTER_CREDITS_URL,
  OPENROUTER_KEYS_URL,
  OPENROUTER_MODELS_URL,
  type SegretarioNotice
} from '@shared/segretario'

/**
 * What SIEVER Mail has to tell the user about the AI, as a popup: the
 * credit or the key gave out and the AI is off, or the credit runs low, in
 * time to top it up. It is kept until the user has seen it — come while
 * the app was closed or the window elsewhere, it is there at the next
 * look — and it is the same wherever the app stands: the setup, the
 * launch screen, the workspace.
 */
export function AiNotice({
  onOpenChange
}: {
  /** Shown or gone: the app's keys rest while it asks for an answer. */
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const [notice, setNotice] = useState<SegretarioNotice | null>(null)

  useEffect(() => {
    let current = true
    // The Segretario that keeps it may not have opened: there is nothing to say then.
    void window.segretarioApi
      .getNotice()
      .then((kept) => current && setNotice(kept))
      .catch(() => undefined)
    const off = window.segretarioApi.onNotice(setNotice)

    return () => {
      current = false
      off()
    }
  }, [])

  useEffect(() => {
    onOpenChange(notice !== null)
  }, [notice, onOpenChange])

  if (!notice) {
    return null
  }

  const { title, body } = noticeWords(notice)
  const off =
    notice.kind === 'credito-finito' ||
    notice.kind === 'chiave-rifiutata' ||
    notice.kind === 'modello-non-disponibile'
  // Where to put it right: the keys, the models, the credit.
  const where =
    notice.kind === 'chiave-rifiutata'
      ? { label: 'Apri OpenRouter', url: OPENROUTER_KEYS_URL }
      : notice.kind === 'modello-non-disponibile'
        ? { label: 'Apri i modelli', url: OPENROUTER_MODELS_URL }
        : { label: 'Ricarica su OpenRouter', url: OPENROUTER_CREDITS_URL }
  const seen = (): void => {
    setNotice(null)
    void window.segretarioApi.dismissNotice()
  }

  return (
    <ConfirmDialog
      open
      title={title}
      description={body}
      confirmLabel={where.label}
      cancelLabel={off ? 'Ho capito' : 'Più tardi'}
      onConfirm={() => {
        void window.mailApi.openExternalUrl(where.url)
        seen()
      }}
      onCancel={seen}
    />
  )
}
