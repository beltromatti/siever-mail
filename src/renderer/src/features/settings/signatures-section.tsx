import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SettingsEmpty, SettingsLoading, SettingsNotice } from '@renderer/components/ui/settings'
import { RichTextEditor, type RichTextEditorHandle } from '@renderer/features/mail/rich-text-editor'
import type { MailAccount, MailAccountSignature } from '@shared/models'

/** A letterhead or signature as it would show: empty when nothing in it would. */
function visibleHtml(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()

  if (!trimmed) {
    return ''
  }

  const hasEmbeddedMedia = /<(?:img|svg|video|audio|hr|table)\b/i.test(trimmed)
  const visibleText = trimmed
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return !visibleText && !hasEmbeddedMedia ? '' : trimmed
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

type Part = 'headerHtml' | 'html'

const PARTS: ReadonlyArray<{ key: Part; title: string; hint: string; placeholder: string }> = [
  {
    key: 'headerHtml',
    title: 'Intestazione',
    hint: 'In cima a ogni messaggio di questa casella, risposte e inoltri compresi: il nome, un logo, una riga. Scrivi sotto di lei.',
    placeholder: 'Nessuna intestazione: scrivila qui, se la vuoi.'
  },
  {
    key: 'html',
    title: 'Firma',
    hint: 'In fondo a ciò che scrivi, sopra il messaggio a cui rispondi. Le righe vuote in cima sono quelle su cui scrivi, con il loro stile.',
    placeholder: 'Nessuna firma: scrivila qui.'
  }
]

/**
 * Impostazioni › Intestazione e firma (vision §6.6, §13.2): for each
 * mailbox, what heads the messages written from it and what closes them.
 * The Posta's alone — a mailbox is what writes and signs.
 */
export function SignaturesSection({
  accounts,
  selectedAccountId,
  busy
}: {
  accounts: ReadonlyArray<MailAccount>
  /** The mailbox the Posta shows: its own are the ones opened first. */
  selectedAccountId: string | null
  /** A connection is being removed or emptied: nothing is saved meanwhile. */
  busy: boolean
}): React.JSX.Element {
  const [saved, setSaved] = useState<Record<string, MailAccountSignature> | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const editorsRef = useRef<Partial<Record<Part, RichTextEditorHandle | null>>>({})

  useEffect(() => {
    let current = true

    window.mailApi
      .listAccountSignatures()
      .then((signatures) => {
        if (current) {
          setSaved(
            Object.fromEntries(signatures.map((signature) => [signature.accountId, signature]))
          )
        }
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(errorText(caught, 'Le firme non si leggono.'))
        }
      })

    return () => {
      current = false
    }
  }, [accounts])

  const accountId =
    (chosen && accounts.some((account) => account.id === chosen) ? chosen : null) ??
    (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)
      ? selectedAccountId
      : (accounts[0]?.id ?? null))
  const stored = accountId ? saved?.[accountId] : undefined
  const blocked = !accountId || busy || saved === null || saving

  /** Both editors of the mailbox in sight are up: before, nothing is read from them, or saved. */
  const editorsReady = (): boolean => PARTS.every(({ key }) => Boolean(editorsRef.current[key]))

  /** What the two editors hold now, against what is kept. */
  const differs = (): boolean =>
    editorsReady() &&
    PARTS.some(
      ({ key }) =>
        visibleHtml(editorsRef.current[key]?.getHTML()) !== visibleHtml(stored?.[key] ?? '')
    )

  const save = async (): Promise<void> => {
    if (!accountId || blocked || !editorsReady()) {
      return
    }

    setError(null)
    setStatus(null)
    setSaving(true)

    try {
      const next = await window.mailApi.setAccountSignature(accountId, {
        headerHtml: visibleHtml(editorsRef.current.headerHtml?.getHTML()),
        html: visibleHtml(editorsRef.current.html?.getHTML())
      })
      setSaved((current) => ({ ...current, [accountId]: next }))
      setChanged(false)
      setStatus('Salvate: valgono dai prossimi messaggi.')
    } catch (caught) {
      setError(errorText(caught, 'Non sono state salvate.'))
    } finally {
      setSaving(false)
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="mt-4">
        <SettingsEmpty>
          Collega una casella di posta per scriverne intestazione e firma.
        </SettingsEmpty>
      </div>
    )
  }

  if (saved === null && !error) {
    return <SettingsLoading>Caricamento delle firme…</SettingsLoading>
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={accountId ?? undefined}
          onValueChange={(next) => {
            // Another mailbox's editors: the ones of this one are let go of.
            editorsRef.current = {}
            setChosen(next)
            setChanged(false)
            setError(null)
            setStatus(null)
          }}
          disabled={busy || saving}
        >
          <SelectTrigger className="min-w-60 flex-1" aria-label="Casella">
            <SelectValue placeholder="Scegli la casella" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={blocked || !changed}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Salva
        </Button>
      </div>

      {PARTS.map((part) => (
        <section key={part.key} className="flex min-h-[11rem] flex-1 flex-col gap-1.5">
          <div>
            <p className="eyebrow">{part.title}</p>
            <p className="text-muted-foreground text-[11.5px] leading-[1.45]">{part.hint}</p>
          </div>
          <div className="min-h-0 flex-1">
            {accountId && saved !== null && (
              <RichTextEditor
                // A mailbox's own editors: the history of one is not another's.
                key={`${accountId}:${part.key}`}
                initialHtml={stored?.[part.key] ?? ''}
                placeholder={part.placeholder}
                disabled={busy}
                expandToContainer
                onReady={(editor) => {
                  editorsRef.current[part.key] = editor
                }}
                onInput={() => setChanged(differs())}
              />
            )}
          </div>
        </section>
      ))}

      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      {status && !error && <SettingsNotice>{status}</SettingsNotice>}
    </div>
  )
}
