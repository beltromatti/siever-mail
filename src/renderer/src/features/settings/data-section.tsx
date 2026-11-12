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
import { languageNow, messagesNow, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, localized, type Language, type Messages } from '@shared/i18n'
import type {
  DataStorageBreakdown,
  DataStorageKind,
  DataStorageSection,
  UninstallKeep,
  UninstallOffer
} from '@shared/models'
import { PLACES } from '@shared/places'

const MESSAGES = defineMessages({
  extensionKeeps: {
    en: 'What the extension keeps',
    it: 'Ciò che l’estensione tiene',
    de: 'Was die Erweiterung aufbewahrt'
  },
  notMeasured: {
    en: 'The data can’t be measured.',
    it: 'Non si riesce a misurare i dati.',
    de: 'Die Daten lassen sich nicht messen.'
  },
  copiesNotRemoved: {
    en: 'The copies of the attachments were not removed.',
    it: 'Le copie degli allegati non si sono tolte.',
    de: 'Die Kopien der Anhänge wurden nicht entfernt.'
  },
  ofSegretario: {
    en: (size: string) => `, ${size} of it the Segretario’s`,
    it: (size: string) => `, di cui ${size} del Segretario`,
    de: (size: string) => `, davon ${size} vom Segretario`
  },
  segretarioData: {
    en: 'The memory, projects, activity and conversations',
    it: 'La memoria, i progetti, il diario e le conversazioni',
    de: 'Das Gedächtnis, die Projekte, der Verlauf und die Unterhaltungen'
  },
  commonData: {
    en: 'The address book, preferences, recent files and the drafts’ attachments',
    it: 'La rubrica, le preferenze, i file recenti e gli allegati delle bozze',
    de: 'Das Adressbuch, die Einstellungen, die zuletzt verwendeten Dateien und die Anhänge der Entwürfe'
  },
  attachmentsData: {
    en: 'The attachments you opened: they download again when needed',
    it: 'Gli allegati che hai aperto: si scaricano di nuovo quando servono',
    de: 'Die Anhänge, die Sie geöffnet haben: Sie werden bei Bedarf erneut geladen'
  },
  diagnosticsData: {
    en: 'The log of what happens, below',
    it: 'Il registro di ciò che succede, qui sotto',
    de: 'Das Protokoll dessen, was geschieht, weiter unten'
  },
  everything: {
    en: 'the mail and calendars, the address book, the letterheads and signatures, the drafts, the recent files and the copies of attachments',
    it: 'la posta e i calendari, la rubrica, le intestazioni e le firme, le bozze, i file recenti e le copie degli allegati',
    de: 'die E-Mails und Kalender, das Adressbuch, die Briefköpfe und Signaturen, die Entwürfe, die zuletzt verwendeten Dateien und die Kopien der Anhänge'
  },
  onThisComputer: { en: 'On this computer', it: 'Su questo computer', de: 'Auf diesem Computer' },
  onThisComputerText: {
    en: 'Everything SIEVER Mail keeps here, connection by connection: no data leaves the computer.',
    it: 'Tutto ciò che SIEVER Mail tiene qui, connessione per connessione: nessun dato esce dal computer.',
    de: 'Alles, was SIEVER Mail hier aufbewahrt, Verbindung für Verbindung: Keine Daten verlassen den Computer.'
  },
  measuring: { en: 'Measuring the data…', it: 'Misuro i dati…', de: 'Daten werden gemessen…' },
  downloadAgainTitle: {
    en: (label: string) => `Download ${label} again?`,
    it: (label: string) => `Scaricare di nuovo ${label}?`,
    de: (label: string) => `${label} erneut laden?`
  },
  downloadAgainText: {
    en: 'Its mail is removed from this computer and downloaded again from the server, as when it was first connected. The connection, the signature, the drafts and what the Segretario knows about it stay.',
    it: 'La sua posta si toglie da questo computer e si scarica di nuovo dal server, come al primo collegamento. Restano il collegamento, la firma, le bozze e ciò che il Segretario ne sa.',
    de: 'Seine E-Mails werden von diesem Computer entfernt und erneut vom Server geladen, wie bei der ersten Verbindung. Die Verbindung, die Signatur, die Entwürfe und was der Segretario darüber weiß, bleiben.'
  },
  downloadAgain: { en: 'Download again', it: 'Scarica di nuovo', de: 'Erneut laden' },
  empty: { en: 'Empty', it: 'Svuota', de: 'Leeren' },
  startOver: { en: 'Start over', it: 'Ricomincia da capo', de: 'Neu beginnen' },
  startOverText: {
    en: (everything: string, ai: boolean) =>
      `This removes from this computer ${everything}${ai ? '; the Segretario forgets everything, its key too, and the AI features turn off' : ''}. The connections and your preferences stay, and what is outside SIEVER Mail: the mail on the servers, the calendars, your files. The mail and calendars download again.`,
    it: (everything: string, ai: boolean) =>
      `Si tolgono da questo computer ${everything}${ai ? '; il Segretario dimentica tutto, anche la chiave, e le funzioni AI si spengono' : ''}. Restano le connessioni e le tue preferenze, e ciò che sta fuori da SIEVER Mail: la posta sui server, i calendari, i tuoi file. La posta e i calendari si scaricano di nuovo.`,
    de: (everything: string, ai: boolean) =>
      `Von diesem Computer werden entfernt: ${everything}${ai ? '; der Segretario vergisst alles, auch den Schlüssel, und die KI-Funktionen werden ausgeschaltet' : ''}. Es bleiben die Verbindungen und Ihre Einstellungen sowie alles außerhalb von SIEVER Mail: die E-Mails auf den Servern, die Kalender, Ihre Dateien. E-Mails und Kalender werden erneut geladen.`
  },
  deleteAllTitle: {
    en: 'Delete all data?',
    it: 'Eliminare tutti i dati?',
    de: 'Alle Daten löschen?'
  },
  deleteAllText: {
    en: (everything: string, ai: boolean) =>
      `This removes ${everything}${ai ? '; the Segretario forgets everything and the AI features turn off' : ''}. The connections, the preferences and what is outside SIEVER Mail stay, like the mail on the servers and your files: the mail and calendars download again.`,
    it: (everything: string, ai: boolean) =>
      `Si tolgono ${everything}${ai ? '; il Segretario dimentica tutto e le funzioni AI si spengono' : ''}. Restano le connessioni, le preferenze e ciò che sta fuori da SIEVER Mail, come la posta sui server e i tuoi file: la posta e i calendari si scaricano di nuovo.`,
    de: (everything: string, ai: boolean) =>
      `Entfernt werden: ${everything}${ai ? '; der Segretario vergisst alles, und die KI-Funktionen werden ausgeschaltet' : ''}. Es bleiben die Verbindungen, die Einstellungen und alles außerhalb von SIEVER Mail, etwa die E-Mails auf den Servern und Ihre Dateien: E-Mails und Kalender werden erneut geladen.`
  },
  macRemoval: {
    en: 'Dragging it to the Trash removes only the program and leaves its data: from here it goes with what it keeps.',
    it: 'Trascinarlo nel Cestino toglie solo il programma, e lascia i suoi dati: da qui se ne va con ciò che tiene.',
    de: 'In den Papierkorb gezogen, wird nur das Programm entfernt, und seine Daten bleiben: Von hier aus geht es mit allem, was es aufbewahrt.'
  },
  windowsRemoval: {
    en: 'The same can be done from Windows Settings › Apps, which asks the same thing.',
    it: 'Lo stesso si fa da Impostazioni di Windows › App, che chiede la stessa cosa.',
    de: 'Dasselbe geht über die Windows-Einstellungen › Apps, die dasselbe fragen.'
  },
  linuxAppImage: {
    en: 'The AppImage file goes too.',
    it: 'Se ne va anche il file AppImage.',
    de: 'Auch die AppImage-Datei wird entfernt.'
  },
  linuxPackage: {
    en: 'The data goes from here; the program is then removed with the package manager.',
    it: 'I dati se ne vanno da qui; il programma si toglie poi con il gestore dei pacchetti.',
    de: 'Die Daten werden hier entfernt; das Programm entfernen Sie danach mit der Paketverwaltung.'
  },
  uninstallTitle: {
    en: 'Remove SIEVER Mail from this computer?',
    it: 'Togliere SIEVER Mail da questo computer?',
    de: 'SIEVER Mail von diesem Computer entfernen?'
  },
  outsideStays: {
    en: 'What is outside SIEVER Mail stays as it is: the mail on the servers, the calendars, your files.',
    it: 'Ciò che sta fuori da SIEVER Mail resta com’è: la posta sui server, i calendari, i tuoi file.',
    de: 'Was außerhalb von SIEVER Mail liegt, bleibt, wie es ist: die E-Mails auf den Servern, die Kalender, Ihre Dateien.'
  },
  closes: {
    en: 'SIEVER Mail closes.',
    it: 'SIEVER Mail si chiude.',
    de: 'SIEVER Mail wird geschlossen.'
  },
  uninstall: { en: 'Uninstall', it: 'Disinstalla', de: 'Deinstallieren' },
  notRemoved: {
    en: 'SIEVER Mail could not be removed.',
    it: 'SIEVER Mail non si è potuto togliere.',
    de: 'SIEVER Mail konnte nicht entfernt werden.'
  },
  removeHeading: {
    en: 'Remove SIEVER Mail from this computer',
    it: 'Togli SIEVER Mail da questo computer',
    de: 'SIEVER Mail von diesem Computer entfernen'
  },
  whatStays: { en: 'What stays', it: 'Che cosa resta', de: 'Was bleibt' },
  theConnections: { en: 'The connections', it: 'Le connessioni', de: 'Die Verbindungen' },
  nothing: { en: 'Nothing', it: 'Niente', de: 'Nichts' },
  developmentCopy: {
    en: 'SIEVER Mail removes itself from here in the installed app: this is a development copy.',
    it: 'SIEVER Mail si toglie da qui nell’app installata: questa è una copia di sviluppo.',
    de: 'In der installierten App entfernt sich SIEVER Mail von hier aus: Dies ist eine Entwicklungskopie.'
  }
})

/** A size as the region writes numbers: "1.5 GB", "1,5 GB". */
function sizeWords(bytes: number): string {
  const size = new Intl.NumberFormat(languageNow().formatLocale, { maximumFractionDigits: 1 })
  const megabytes = bytes / 1024 / 1024

  if (megabytes >= 1024) {
    return `${size.format(megabytes / 1024)} GB`
  }

  return megabytes >= 1
    ? `${size.format(megabytes)} MB`
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

/** The extension's words for what it keeps, in the interface's language: empty when nothing. */
function extensionDataLabel(language: Language): string {
  return localized(extensionRenderer.localDataLabel, language)
}

/** The extension's words for what it keeps, as a sentence. */
function extensionData(m: Messages<typeof MESSAGES>, language: Language): string {
  const label = extensionDataLabel(language)
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : m.extensionKeeps
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error && error.message.trim() ? error.message : undefined
}

/** What a share holds, in a line: its source, and the Segretario's part of it. */
function sectionWords(
  m: Messages<typeof MESSAGES>,
  places: Messages<typeof PLACES>,
  language: Language,
  section: DataStorageSection,
  aiShown: boolean
): string {
  const ofSegretario =
    aiShown && section.segretarioBytes > 0 ? m.ofSegretario(sizeWords(section.segretarioBytes)) : ''
  const size = sizeWords(section.sizeBytes)

  switch (section.kind) {
    case 'mail':
      return `${places.mail} · ${size}${ofSegretario}`
    case 'calendar':
      return `${places.calendar} · ${size}${ofSegretario}`
    case 'segretario':
      return `${m.segretarioData} · ${size}`
    case 'common':
      return `${m.commonData} · ${size}`
    case 'extension':
      return `${extensionData(m, language)} · ${size}`
    case 'attachments':
      return `${m.attachmentsData} · ${size}`
    case 'diagnostics':
      return `${m.diagnosticsData} · ${size}`
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
  const m = useMessages(MESSAGES)
  const places = useMessages(PLACES)
  const { language } = useLanguage()
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
          setError(errorText(caught) ?? messagesNow(MESSAGES).notMeasured)
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
      setError(errorText(caught) ?? messagesNow(MESSAGES).copiesNotRemoved)
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
  const extensionLabel = extensionDataLabel(language)
  const everything = `${m.everything}${extensionLabel ? `; ${extensionLabel}` : ''}`

  return (
    <SettingsPage>
      <SettingsGroup title={m.onThisComputer} description={m.onThisComputerText}>
        {!breakdown && !error && (
          <p className="text-muted-foreground flex items-center gap-2 text-[12px]">
            <LoaderCircle className="size-4 animate-spin" />
            {m.measuring}
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
            description={sectionWords(m, places, language, section, aiShown)}
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
                    title: m.downloadAgainTitle(section.label),
                    description: m.downloadAgainText,
                    confirmLabel: m.downloadAgain
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
                {m.downloadAgain}
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
                {m.empty}
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
                {places.forgetEverything}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </ActionRow>
        ))}
        {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
      </SettingsGroup>

      <DiagnosticsGroup aiOn={aiOn} />

      <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
        <p className="eyebrow">{m.startOver}</p>
        <p className="text-muted-foreground text-[11px]">{m.startOverText(everything, aiShown)}</p>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="w-fit gap-2"
          disabled={clearingAll || busy}
          onClick={() =>
            void confirm({
              title: m.deleteAllTitle,
              description: m.deleteAllText(everything, aiShown),
              confirmLabel: places.deleteAllData,
              destructive: true
            }).then((confirmed) => confirmed && onClearAll())
          }
        >
          {clearingAll ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          {places.deleteAllData}
        </Button>
      </div>

      <UninstallBox busy={busy || clearingAll} confirm={confirm} />

      {confirmDialog}
    </SettingsPage>
  )
}

/** What stays, in words: the same in the box and in its confirmation. */
const STAYS = defineMessages({
  connessioni: {
    en: 'Only the connections stay, that is the mailboxes and calendars with their sign-ins: install it again and you find them already connected, and everything else starts over, from the guided setup.',
    it: 'Restano solo le connessioni, cioè le caselle e i calendari con i loro accessi: installandolo di nuovo li ritrovi già collegati, e tutto il resto riparte da capo, dalla procedura guidata.',
    de: 'Nur die Verbindungen bleiben, also die Postfächer und Kalender mit ihren Zugängen: Wenn Sie es erneut installieren, sind sie bereits verbunden, und alles andere beginnt von vorn, mit der Einrichtung.'
  },
  niente: {
    en: 'Nothing of SIEVER Mail stays on this computer: no data, no sign-ins, no preferences.',
    it: 'Non resta niente di SIEVER Mail su questo computer: né dati, né accessi, né preferenze.',
    de: 'Von SIEVER Mail bleibt nichts auf diesem Computer: keine Daten, keine Zugänge, keine Einstellungen.'
  }
}) satisfies Record<UninstallKeep, unknown>

/** How the system takes a program away, beside what SIEVER Mail does here. */
function systemWords(m: Messages<typeof MESSAGES>, offer: UninstallOffer): string {
  switch (offer.system) {
    case 'mac':
      return m.macRemoval
    case 'windows':
      return m.windowsRemoval
    case 'linux':
      return offer.removesProgram ? m.linuxAppImage : m.linuxPackage
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
  const m = useMessages(MESSAGES)
  const stays = useMessages(STAYS)
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
      title: m.uninstallTitle,
      description: `${stays[keep]} ${m.outsideStays} ${m.closes}`,
      confirmLabel: m.uninstall,
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
      setError(errorText(caught) ?? messagesNow(MESSAGES).notRemoved)
    }
  }

  return (
    <div className="border-destructive/35 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3">
      <p className="eyebrow">{m.removeHeading}</p>
      {offer.available ? (
        <>
          <OptionsRow
            title={m.whatStays}
            description={stays[keep]}
            value={keep}
            label={m.whatStays}
            disabled={leaving}
            options={[
              { value: 'connessioni', label: m.theConnections },
              { value: 'niente', label: m.nothing }
            ]}
            onChange={setKeep}
          />
          <p className="text-muted-foreground text-[11px]">
            {m.outsideStays} {systemWords(m, offer)}
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
            {m.uninstall}
          </Button>
          {error && <SettingsNotice tone="error">{error}</SettingsNotice>}
        </>
      ) : (
        <p className="text-muted-foreground text-[11px]">{m.developmentCopy}</p>
      )}
    </div>
  )
}
