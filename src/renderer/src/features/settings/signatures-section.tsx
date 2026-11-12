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
import { accessOfMail } from '@renderer/features/connections/connection-groups'
import { ConnectionName } from '@renderer/features/connections/connection-name'
import { RichTextEditor, type RichTextEditorHandle } from '@renderer/features/mail/rich-text-editor'
import { messagesNow, useMessages } from '@renderer/lib/i18n'
import { defineMessages } from '@shared/i18n'
import type { MailAccount, MailAccountSignature } from '@shared/models'

const MESSAGES = defineMessages({
  letterhead: { en: 'Letterhead', it: 'Intestazione', de: 'Briefkopf' },
  letterheadHint: {
    en: 'At the top of every message from this mailbox, replies and forwards included: the name, a logo, a line. You write below it.',
    it: 'In cima a ogni messaggio di questa casella, risposte e inoltri compresi: il nome, un logo, una riga. Scrivi sotto di lei.',
    de: 'Oben in jeder Nachricht aus diesem Postfach, Antworten und Weiterleitungen eingeschlossen: der Name, ein Logo, eine Zeile. Sie schreiben darunter.'
  },
  letterheadPlaceholder: {
    en: 'No letterhead: write it here, if you want one.',
    it: 'Nessuna intestazione: scrivila qui, se la vuoi.',
    de: 'Kein Briefkopf: Schreiben Sie ihn hier, wenn Sie einen möchten.'
  },
  signature: { en: 'Signature', it: 'Firma', de: 'Signatur' },
  signatureHint: {
    en: 'At the end of what you write, above the message you reply to. The empty lines at the top are the ones you write on, with their style.',
    it: 'In fondo a ciò che scrivi, sopra il messaggio a cui rispondi. Le righe vuote in cima sono quelle su cui scrivi, con il loro stile.',
    de: 'Am Ende dessen, was Sie schreiben, über der Nachricht, auf die Sie antworten. Die leeren Zeilen oben sind die, auf denen Sie schreiben, mit ihrem Stil.'
  },
  signaturePlaceholder: {
    en: 'No signature: write it here.',
    it: 'Nessuna firma: scrivila qui.',
    de: 'Keine Signatur: Schreiben Sie sie hier.'
  },
  unreadable: {
    en: 'The signatures can’t be read.',
    it: 'Le firme non si leggono.',
    de: 'Die Signaturen lassen sich nicht lesen.'
  },
  saved: {
    en: 'Saved: they apply from the next messages.',
    it: 'Salvate: valgono dai prossimi messaggi.',
    de: 'Gespeichert: Sie gelten ab den nächsten Nachrichten.'
  },
  notSaved: {
    en: 'They were not saved.',
    it: 'Non sono state salvate.',
    de: 'Sie wurden nicht gespeichert.'
  },
  noAccounts: {
    en: 'Connect a mailbox to write its letterhead and signature.',
    it: 'Collega una casella di posta per scriverne intestazione e firma.',
    de: 'Verbinden Sie ein Postfach, um seinen Briefkopf und seine Signatur zu schreiben.'
  },
  loading: {
    en: 'Loading the signatures…',
    it: 'Caricamento delle firme…',
    de: 'Signaturen werden geladen…'
  },
  mailbox: { en: 'Mailbox', it: 'Casella', de: 'Postfach' },
  chooseMailbox: { en: 'Choose the mailbox', it: 'Scegli la casella', de: 'Postfach wählen' },
  save: { en: 'Save', it: 'Salva', de: 'Speichern' }
})

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

type Words = keyof typeof MESSAGES

const PARTS: ReadonlyArray<{ key: Part; title: Words; hint: Words; placeholder: Words }> = [
  {
    key: 'headerHtml',
    title: 'letterhead',
    hint: 'letterheadHint',
    placeholder: 'letterheadPlaceholder'
  },
  { key: 'html', title: 'signature', hint: 'signatureHint', placeholder: 'signaturePlaceholder' }
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
  const m = useMessages(MESSAGES)
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
          setError(errorText(caught, messagesNow(MESSAGES).unreadable))
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
      setStatus(m.saved)
    } catch (caught) {
      setError(errorText(caught, m.notSaved))
    } finally {
      setSaving(false)
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="mt-4">
        <SettingsEmpty>{m.noAccounts}</SettingsEmpty>
      </div>
    )
  }

  if (saved === null && !error) {
    return <SettingsLoading>{m.loading}</SettingsLoading>
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
          <SelectTrigger className="min-w-60 flex-1" aria-label={m.mailbox}>
            <SelectValue placeholder={m.chooseMailbox} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                <ConnectionName provider={accessOfMail(account)}>{account.email}</ConnectionName>
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
          {m.save}
        </Button>
      </div>

      {PARTS.map((part) => (
        <section key={part.key} className="flex min-h-[11rem] flex-1 flex-col gap-1.5">
          <div>
            <p className="eyebrow">{m[part.title]}</p>
            <p className="text-muted-foreground text-[11.5px] leading-[1.45]">{m[part.hint]}</p>
          </div>
          <div className="min-h-0 flex-1">
            {accountId && saved !== null && (
              <RichTextEditor
                // A mailbox's own editors: the history of one is not another's.
                key={`${accountId}:${part.key}`}
                initialHtml={stored?.[part.key] ?? ''}
                placeholder={m[part.placeholder]}
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
