import { useEffect, useState } from 'react'
import { ArrowRight, Download, LoaderCircle, LogOut, Trash2 } from 'lucide-react'

import extensionRenderer from '@app/extension/renderer'
import { Button } from '@renderer/components/ui/button'
import { useConfirmDialog } from '@renderer/components/ui/confirm-dialog'
import {
  ActionRow,
  OptionsRow,
  SettingsGroup,
  SettingsNotice,
  SettingsPage
} from '@renderer/components/ui/settings'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { DiagnosticsGroup } from '@renderer/features/settings/diagnostics-group'
import { cn } from '@renderer/lib/utils'
import type {
  DataStorageBreakdown,
  DataStorageKind,
  DataStorageSection,
  UninstallKeep,
  UninstallOffer
} from '@shared/models'

const SIZE = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 })

function sizeWords(bytes: number): string {
  const megabytes = bytes / 1024 / 1024

  if (megabytes >= 1024) {
    return `${SIZE.format(megabytes / 1024)} GB`
  }

  return megabytes >= 1
    ? `${SIZE.format(megabytes)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Each kind's colour, from the theme; the mailboxes in their own shades of the mail's. */
const COLOURS: Readonly<Record<DataStorageKind, string>> = {
  mail: 'bg-data-mail',
  calendar: 'bg-data-calendar',
  segretario: 'bg-data-segretario',
  common: 'bg-data-common',
  extension: 'bg-data-extension',
  attachments: 'bg-data-files',
  diagnostics: 'bg-data-files'
}
const SHADES = ['', 'opacity-75', 'opacity-55', 'opacity-40']

/** The extension's words for what it keeps, as a sentence. */
const EXTENSION_DATA = extensionRenderer.localDataLabel
  ? extensionRenderer.localDataLabel.charAt(0).toUpperCase() +
    extensionRenderer.localDataLabel.slice(1)
  : 'Ciò che l’estensione tiene'

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

/** What a share holds, in a line: its source, and the Segretario's part of it. */
function sectionWords(section: DataStorageSection, aiShown: boolean): string {
  const ofSegretario =
    aiShown && section.segretarioBytes > 0
      ? `, di cui ${sizeWords(section.segretarioBytes)} del Segretario`
      : ''

  switch (section.kind) {
    case 'mail':
      return `Posta · ${sizeWords(section.sizeBytes)}${ofSegretario}`
    case 'calendar':
      return `Calendario · ${sizeWords(section.sizeBytes)}${ofSegretario}`
    case 'segretario':
      return `La memoria, i progetti, il diario e le conversazioni · ${sizeWords(section.sizeBytes)}`
    case 'common':
      return `La rubrica, le preferenze, i file recenti e gli allegati delle bozze · ${sizeWords(section.sizeBytes)}`
    case 'extension':
      return `${EXTENSION_DATA} · ${sizeWords(section.sizeBytes)}`
    case 'attachments':
      return `Gli allegati che hai aperto: si scaricano di nuovo quando servono · ${sizeWords(section.sizeBytes)}`
    case 'diagnostics':
      return `Il registro di ciò che succede, qui sotto · ${sizeWords(section.sizeBytes)}`
  }
}

/**
 * Impostazioni › Dati (vision §13.2): what SIEVER Mail keeps on this
 * computer — not what lives outside it, the mail on the servers, the user's
 * files, what an extension wrote out (an archive on a share) —, by whose it is — each connection at par, with the Segretario's
 * share of it, the Segretario's own, what every app shares, the
 * extension's, the files beside — and what can go: a mailbox's mail, to be
 * downloaded again; the copies of opened attachments; the Segretario's all,
 * from its page; everything, the connections and preferences apart.
 */
export function DataSection({
  aiOn,
  clearingMailboxId,
  clearingAll,
  busy,
  onClearMailbox,
  onClearAll,
  onOpenSegretario
}: {
  aiOn: boolean
  /** The mailbox whose mail is being downloaded again, while it goes. */
  clearingMailboxId: string | null
  clearingAll: boolean
  /** A connection is being removed or emptied: nothing else goes meanwhile. */
  busy: boolean
  onClearMailbox: (accountId: string) => void
  onClearAll: () => void
  /** «Dimentica tutto» is the Segretario's page's. */
  onOpenSegretario: () => void
}): React.JSX.Element {
  const [breakdown, setBreakdown] = useState<DataStorageBreakdown | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [emptyingCopies, setEmptyingCopies] = useState(false)
  const { confirm, dialog: confirmDialog } = useConfirmDialog()

  useEffect(() => {
    let current = true

    window.mailApi
      .getDataStorageBreakdown()
      .then((measured) => {
        if (current) {
          setBreakdown(measured)
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (current) {
          setError(errorText(caught) ?? 'Non si riesce a misurare i dati.')
        }
      })

    return () => {
      current = false
    }
    // Measured again after anything here changed what is kept.
  }, [revision, clearingMailboxId, clearingAll])

  const emptyCopies = async (): Promise<void> => {
    setEmptyingCopies(true)

    try {
      await window.mailApi.clearAttachmentCache()
      setRevision((current) => current + 1)
    } catch (caught) {
      setError(errorText(caught) ?? 'Le copie degli allegati non si sono tolte.')
    } finally {
      setEmptyingCopies(false)
    }
  }

  // The Segretario shows only where it is, or was: off and never on, nothing of it.
  const segretario = breakdown?.sections.find((section) => section.kind === 'segretario')
  const aiShown = aiOn || (segretario?.sizeBytes ?? 0) > 0
  // Measured or not, the rest of the page is there: the diagnostics, and starting over.
  const sections = (breakdown?.sections ?? []).filter(
    (section) => section.sizeBytes > 0 && (section.kind !== 'segretario' || aiShown)
  )
  const total = Math.max(
    1,
    sections.reduce((sum, section) => sum + section.sizeBytes, 0)
  )
  let mailShade = 0
  const colours = new Map(
    sections.map((section) => [
      section.id,
      cn(COLOURS[section.kind], section.kind === 'mail' && SHADES[mailShade++ % SHADES.length])
    ])
  )
  // What goes, in words: the app's, then the extension's, which says its own in a phrase.
  const everything = `la posta e i calendari, la rubrica, le intestazioni e le firme, le bozze, i file recenti e le copie degli allegati${
    extensionRenderer.localDataLabel ? `; ${extensionRenderer.localDataLabel}` : ''
  }`

  return (
    <SettingsPage>
      <SettingsGroup
        title="Su questo computer"
        description="Tutto ciò che SIEVER Mail tiene qui, connessione per connessione: nessun dato esce dal computer."
      >
        {!breakdown && !error && (
          <p className="text-muted-foreground flex items-center gap-2 text-[12px]">
            <LoaderCircle className="size-4 animate-spin" />
            Misuro i dati…
          </p>
        )}
        {breakdown && <p className="display-title text-[22px] leading-none">{sizeWords(total)}</p>}
        {breakdown && (
          <div className="bg-muted/45 flex h-2.5 w-full gap-px overflow-hidden rounded-full">
            {sections.map((section) => (
              <Tooltip key={section.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn('h-full min-w-[3px]', colours.get(section.id))}
                    style={{ width: `${(section.sizeBytes / total) * 100}%` }}
                    aria-label={`${section.label}: ${sizeWords(section.sizeBytes)}`}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {section.label}: {sizeWords(section.sizeBytes)}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}

        {sections.map((section) => (
          <ActionRow
            key={section.id}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', colours.get(section.id))}
                />
                <span className="truncate">{section.label}</span>
              </span>
            }
            description={sectionWords(section, aiShown)}
          >
            {section.kind === 'mail' && section.connectionId && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() =>
                  void confirm({
                    title: `Scaricare di nuovo ${section.label}?`,
                    description:
                      'La sua posta si toglie da questo computer e si scarica di nuovo dal server, come al primo collegamento. Restano il collegamento, la firma, le bozze e ciò che il Segretario ne sa.',
                    confirmLabel: 'Scarica di nuovo'
                  }).then(
                    (confirmed) =>
                      confirmed && section.connectionId && onClearMailbox(section.connectionId)
                  )
                }
              >
                {clearingMailboxId === section.connectionId ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                Scarica di nuovo
              </Button>
            )}
            {section.kind === 'attachments' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                disabled={emptyingCopies || busy}
                onClick={() => void emptyCopies()}
              >
                {emptyingCopies ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Svuota
              </Button>
            )}
            {section.kind === 'segretario' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={onOpenSegretario}
              >
                Dimentica tutto
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </ActionRow>
        ))}
        {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      </SettingsGroup>

      <DiagnosticsGroup aiOn={aiOn} />

      <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
        <p className="eyebrow">Ricomincia da capo</p>
        <p className="text-muted-foreground text-[11px]">
          Si tolgono da questo computer {everything}
          {aiShown
            ? '; il Segretario dimentica tutto, anche la chiave, e le funzioni AI si spengono'
            : ''}
          . Restano le connessioni e le tue preferenze, e ciò che sta fuori da SIEVER Mail: la posta
          sui server, i calendari, i tuoi file. La posta e i calendari si scaricano di nuovo.
        </p>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="w-fit gap-2"
          disabled={clearingAll || busy}
          onClick={() =>
            void confirm({
              title: 'Eliminare tutti i dati?',
              description: `Si tolgono ${everything}${aiShown ? '; il Segretario dimentica tutto e le funzioni AI si spengono' : ''}. Restano le connessioni, le preferenze e ciò che sta fuori da SIEVER Mail, come la posta sui server e i tuoi file: la posta e i calendari si scaricano di nuovo.`,
              confirmLabel: 'Elimina tutti i dati',
              destructive: true
            }).then((confirmed) => confirmed && onClearAll())
          }
        >
          {clearingAll ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Elimina tutti i dati
        </Button>
      </div>

      <UninstallBox busy={busy || clearingAll} confirm={confirm} />

      {confirmDialog}
    </SettingsPage>
  )
}

/** What stays, in words: the same in the box and in its confirmation. */
const STAYS: Readonly<Record<UninstallKeep, string>> = {
  connessioni:
    'Restano solo le connessioni, cioè le caselle e i calendari con i loro accessi: installandolo di nuovo li ritrovi già collegati, e tutto il resto riparte da capo, dalla procedura guidata.',
  niente: 'Non resta niente di SIEVER Mail su questo computer: né dati, né accessi, né preferenze.'
}

/** How the system takes a program away, beside what SIEVER Mail does here. */
function systemWords(offer: UninstallOffer): string {
  switch (offer.system) {
    case 'mac':
      return 'Trascinarlo nel Cestino toglie solo il programma, e lascia i suoi dati: da qui se ne va con ciò che tiene.'
    case 'windows':
      return 'Lo stesso si fa da Impostazioni di Windows › App, che chiede la stessa cosa.'
    case 'linux':
      return offer.removesProgram
        ? 'Se ne va anche il file AppImage.'
        : 'I dati se ne vanno da qui; il programma si toglie poi con il gestore dei pacchetti.'
  }
}

/**
 * Taking SIEVER Mail off the computer (vision §13.2, §15.6): the user
 * chooses what stays — the connections, or nothing — and the app quits for
 * it. Only the installed app takes itself away.
 */
function UninstallBox({
  busy,
  confirm
}: {
  busy: boolean
  confirm: ReturnType<typeof useConfirmDialog>['confirm']
}): React.JSX.Element | null {
  const [offer, setOffer] = useState<UninstallOffer | null>(null)
  const [keep, setKeep] = useState<UninstallKeep>('connessioni')
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    window.mailApi
      .uninstallOffer()
      .then((found) => current && setOffer(found))
      .catch(() => current && setOffer(null))
    return () => {
      current = false
    }
  }, [])

  if (!offer) {
    return null
  }

  const leave = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Togliere SIEVER Mail da questo computer?',
      description: `${STAYS[keep]} Ciò che sta fuori da SIEVER Mail resta com'è: la posta sui server, i calendari, i tuoi file. SIEVER Mail si chiude.`,
      confirmLabel: 'Disinstalla',
      destructive: true
    })

    if (!confirmed) {
      return
    }

    setLeaving(true)
    setError(null)

    try {
      await window.mailApi.uninstall(keep)
    } catch (caught) {
      setLeaving(false)
      setError(errorText(caught) ?? 'SIEVER Mail non si è potuto togliere.')
    }
  }

  return (
    <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
      <p className="eyebrow">Togli SIEVER Mail da questo computer</p>
      {offer.available ? (
        <>
          <OptionsRow
            title="Che cosa resta"
            description={STAYS[keep]}
            value={keep}
            label="Che cosa resta"
            disabled={leaving}
            options={[
              { value: 'connessioni', label: 'Le connessioni' },
              { value: 'niente', label: 'Niente' }
            ]}
            onChange={setKeep}
          />
          <p className="text-muted-foreground text-[11px]">
            Ciò che sta fuori da SIEVER Mail resta com’è: la posta sui server, i calendari, i tuoi
            file. {systemWords(offer)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="w-fit gap-2"
            disabled={busy || leaving}
            onClick={() => void leave()}
          >
            {leaving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Disinstalla
          </Button>
          {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
        </>
      ) : (
        <p className="text-muted-foreground text-[11px]">
          SIEVER Mail si toglie da qui nell’app installata: questa è una copia di sviluppo.
        </p>
      )}
    </div>
  )
}
