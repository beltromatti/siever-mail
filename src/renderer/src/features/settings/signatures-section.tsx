import { useEffect, useState } from 'react'
import { LoaderCircle, Save, Trash2 } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SettingsEmpty, SettingsLoading, SettingsNotice } from '@renderer/components/ui/settings'
import { RichTextEditor } from '@renderer/features/mail/rich-text-editor'
import type { MailAccount } from '@shared/models'

/** A signature as it would show: empty when nothing in it would. */
function visibleSignature(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()

  if (!trimmed) {
    return ''
  }

  const hasEmbeddedMedia = /<(?:img|svg|video|audio)\b/i.test(trimmed)
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

/**
 * Impostazioni › Firme: the signature of each mailbox, added to what is
 * written from it. The Posta's alone — a mailbox is what signs.
 */
export function SignaturesSection({
  accounts,
  selectedAccountId,
  busy
}: {
  accounts: ReadonlyArray<MailAccount>
  /** The mailbox the Posta shows: its signature is the one opened first. */
  selectedAccountId: string | null
  /** A connection is being removed or emptied: nothing is saved meanwhile. */
  busy: boolean
}): React.JSX.Element {
  const [saved, setSaved] = useState<Record<string, string> | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let current = true

    window.mailApi
      .listAccountSignatures()
      .then((signatures) => {
        if (current) {
          const stored = Object.fromEntries(
            signatures.map((signature) => [signature.accountId, signature.html])
          )
          setSaved(stored)
          setDrafts(stored)
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
  const draft = accountId ? (drafts[accountId] ?? '') : ''
  const changed = visibleSignature(draft) !== visibleSignature(accountId ? saved?.[accountId] : '')
  const blocked = !accountId || busy || saved === null || saving

  const save = async (html: string): Promise<void> => {
    if (!accountId || blocked) {
      return
    }

    setError(null)
    setStatus(null)
    setSaving(true)

    try {
      const stored = (await window.mailApi.setAccountSignature(accountId, html))?.html ?? ''
      setSaved((current) => ({ ...current, [accountId]: stored }))
      setDrafts((current) => ({ ...current, [accountId]: stored }))
      setStatus(stored ? 'Firma salvata.' : 'Firma tolta.')
    } catch (caught) {
      setError(errorText(caught, 'La firma non è stata salvata.'))
    } finally {
      setSaving(false)
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="mt-4">
        <SettingsEmpty>Collega una casella di posta per scriverne la firma.</SettingsEmpty>
      </div>
    )
  }

  if (saved === null && !error) {
    return <SettingsLoading>Caricamento delle firme…</SettingsLoading>
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={accountId ?? undefined}
          onValueChange={(next) => {
            setChosen(next)
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
          variant="outline"
          className="gap-1.5"
          disabled={blocked || !visibleSignature(draft)}
          onClick={() => {
            if (accountId) {
              setDrafts((current) => ({ ...current, [accountId]: '' }))
            }

            void save('')
          }}
        >
          <Trash2 className="size-3.5" />
          Togli la firma
        </Button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={blocked || !changed}
          onClick={() => void save(draft)}
        >
          {saving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Salva
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        <RichTextEditor
          // A mailbox's own editor: the history of one is not another's.
          key={accountId ?? 'none'}
          value={draft}
          placeholder="Scrivi la firma di questa casella…"
          disabled={!accountId || busy}
          showExpandToggle={false}
          // Without this the editor keeps its natural height and spills past the page's edge.
          expandToContainer
          onChange={(html) => {
            if (accountId) {
              setDrafts((current) => ({ ...current, [accountId]: html }))
            }
          }}
        />
      </div>

      {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      {status && !error && <SettingsNotice>{status}</SettingsNotice>}
    </div>
  )
}
