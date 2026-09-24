import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import type { AccountConnectionState, MailAccount } from '@shared/models'

export type SyncTone = 'ok' | 'busy' | 'problem'

export interface SyncSummary {
  tone: SyncTone
  label: string
  /** One or two sentences for the tooltip: what is happening, and what next. */
  detail: string
}

const TIME_FORMAT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })

function accountLabel(account: MailAccount): string {
  return account.email || account.displayName
}

function andOthers(count: number): string {
  if (count <= 1) {
    return ''
  }

  return count === 2 ? ' e un altro account' : ` e altri ${count - 1} account`
}

function lastContactSentence(states: AccountConnectionState[]): string {
  const lastContactAt = Math.max(0, ...states.map((state) => state.lastContactAt ?? 0))

  return lastContactAt > 0
    ? ` Ultimo aggiornamento alle ${TIME_FORMAT.format(new Date(lastContactAt))}.`
    : ''
}

/**
 * What the header says about the accounts on screen — the selected one, or
 * every account under TUTTI. "Sincronizzato" only while every one of them is
 * actually connected and has finished downloading: a link being rebuilt, a
 * missing network and a server that stopped answering each say so, the most
 * serious first. Returns null when there is nothing to report on.
 */
export function summarizeSyncStatus(
  accounts: ReadonlyArray<MailAccount>,
  connections: Readonly<Record<string, AccountConnectionState>>
): SyncSummary | null {
  if (accounts.length === 0) {
    return null
  }

  const entries = accounts.map((account) => ({ account, state: connections[account.id] }))
  const withStatus = (...statuses: AccountConnectionState['status'][]): typeof entries =>
    entries.filter((entry) => entry.state && statuses.includes(entry.state.status))

  const refused = withStatus('error').filter((entry) => entry.state?.authFailed)

  if (refused.length > 0) {
    return {
      tone: 'problem',
      label: 'Accesso non riuscito',
      detail:
        `Il server di ${accountLabel(refused[0].account)}${andOthers(refused.length)} ha ` +
        "rifiutato l'accesso. Se la password è cambiata, ricollega l'account dalle Impostazioni."
    }
  }

  const offline = withStatus('offline')

  if (offline.length > 0) {
    return {
      tone: 'problem',
      label: 'Non in linea',
      detail:
        'Nessuna connessione di rete. La posta si aggiorna da sola appena la rete torna.' +
        lastContactSentence(offline.map((entry) => entry.state as AccountConnectionState))
    }
  }

  const unreachable = withStatus('error')

  if (unreachable.length > 0) {
    return {
      tone: 'problem',
      label: 'Connessione persa',
      detail:
        `Il server di ${accountLabel(unreachable[0].account)}${andOthers(unreachable.length)} ` +
        'non risponde. SIEVER Mail riprova da solo.' +
        lastContactSentence(unreachable.map((entry) => entry.state as AccountConnectionState))
    }
  }

  if (withStatus('reconnecting').length > 0) {
    return {
      tone: 'busy',
      label: 'Riconnessione…',
      detail: 'Il collegamento con il server si è interrotto e si sta ristabilendo.'
    }
  }

  if (entries.some((entry) => !entry.state || entry.state.status !== 'connected')) {
    return { tone: 'busy', label: 'Connessione…', detail: 'Collegamento al server di posta.' }
  }

  if (entries.some((entry) => entry.state?.syncing)) {
    return {
      tone: 'busy',
      label: 'Sincronizzazione…',
      detail: 'Download della posta in corso. I messaggi compaiono man mano che arrivano.'
    }
  }

  return {
    tone: 'ok',
    label: 'Sincronizzato',
    detail: 'Collegato al server: i nuovi messaggi arrivano in tempo reale.'
  }
}

export function SyncStatusIndicator({ summary }: { summary: SyncSummary }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex min-w-0 cursor-default items-center gap-1.5" role="status">
          <span
            className={cn(
              'inline-block size-1.5 shrink-0 rounded-full',
              summary.tone === 'ok' && 'bg-status-online',
              summary.tone === 'busy' && 'bg-muted-foreground/70 animate-pulse',
              summary.tone === 'problem' && 'bg-status-offline'
            )}
          />
          <span className={cn('truncate', summary.tone === 'problem' && 'text-status-offline')}>
            {summary.label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-72 font-normal">
        {summary.detail}
      </TooltipContent>
    </Tooltip>
  )
}
