import { ExternalLink } from 'lucide-react'

import extensionShared from '@app/extension/shared'
import { Button } from '@renderer/components/ui/button'
import { SettingsPage } from '@renderer/components/ui/settings'
import { useLanguage, useMessages } from '@renderer/lib/i18n'
import { formatAppVersion } from '@renderer/lib/utils'
import { defineMessages, localized } from '@shared/i18n'

const MESSAGES = defineMessages({
  installed: { en: 'Installed', it: 'Installata', de: 'Installiert' },
  inVersion: {
    en: (version: string) => `in SIEVER Mail ${version}`,
    it: (version: string) => `in SIEVER Mail ${version}`,
    de: (version: string) => `in SIEVER Mail ${version}`
  },
  none: { en: 'No extension', it: 'Nessuna estensione', de: 'Keine Erweiterung' },
  forEveryone: {
    en: 'This is the edition of SIEVER Mail for everyone: it works on its own, and learns your work from what it sees.',
    it: 'Questa è l’edizione di SIEVER Mail per tutti: funziona da sola, e impara il tuo lavoro da ciò che vede.',
    de: 'Dies ist die Ausgabe von SIEVER Mail für alle: Sie funktioniert eigenständig und lernt Ihre Arbeit aus dem, was sie sieht.'
  },
  whatIs: {
    en: 'What an extension is',
    it: 'Che cos’è un’estensione',
    de: 'Was eine Erweiterung ist'
  },
  whatIsText: {
    en: 'An extension tailors SIEVER Mail to an organization — a company, a practice, a professional — and carries its name. It tells the Segretario how that organization works, what it calls things and where it keeps them; it gives it tools of its own; it adds to the app the actions that work needs. It does not change what SIEVER Mail is: it completes it.',
    it: 'Un’estensione fa SIEVER Mail su misura di un’organizzazione — un’azienda, uno studio, un professionista — e porta il suo nome. Dice al Segretario come lavora quella realtà, come chiama le cose e dove le tiene; gli dà strumenti suoi; aggiunge all’app le azioni che servono a quel lavoro. Non cambia ciò che SIEVER Mail è: lo completa.',
    de: 'Eine Erweiterung passt SIEVER Mail an eine Organisation an – ein Unternehmen, eine Kanzlei, eine Einzelperson im Beruf – und trägt ihren Namen. Sie sagt dem Segretario, wie diese Organisation arbeitet, wie sie die Dinge nennt und wo sie sie aufbewahrt; sie gibt ihm eigene Werkzeuge; sie ergänzt die App um die Aktionen, die diese Arbeit braucht. Sie ändert nicht, was SIEVER Mail ist: Sie vervollständigt es.'
  },
  contact: {
    en: 'To have an extension for your work, contact the developers.',
    it: 'Per avere un’estensione per il tuo lavoro, contatta gli sviluppatori.',
    de: 'Wenn Sie eine Erweiterung für Ihre Arbeit möchten, wenden Sie sich an die Entwickler.'
  },
  projectPage: { en: 'The project page', it: 'La pagina del progetto', de: 'Die Projektseite' }
})

/** Where SIEVER Mail lives, and its developers can be reached. */
const PROJECT_PAGE = 'https://github.com/beltromatti/siever-mail'

/**
 * Settings › Extension: the extension built into this installation, made
 * for an organisation and named after it — or none, with how to have one.
 */
export function ExtensionSection(): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const { language } = useLanguage()
  const identity = extensionShared.identity

  return (
    <SettingsPage>
      {identity ? (
        <div className="settings-group">
          <p className="eyebrow">{m.installed}</p>
          <p className="mt-1 text-[14px] font-semibold">{identity.name}</p>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
            {localized(identity.description, language)}
          </p>
          <p className="text-faint-foreground mt-2 text-[11.5px]">
            {identity.id} · {m.inVersion(formatAppVersion(__APP_VERSION__))}
          </p>
        </div>
      ) : (
        <div className="settings-group">
          <p className="eyebrow">{m.none}</p>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
            {m.forEveryone}
          </p>
        </div>
      )}

      <div className="settings-group">
        <p className="eyebrow">{m.whatIs}</p>
        <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
          {m.whatIsText}
        </p>
        {!identity && (
          <>
            <p className="text-muted-foreground mt-2 max-w-[62ch] text-[12.5px] leading-relaxed">
              {m.contact}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 w-fit gap-2"
              onClick={() => void window.mailApi.openExternalUrl(PROJECT_PAGE)}
            >
              <ExternalLink className="size-3.5" />
              {m.projectPage}
            </Button>
          </>
        )}
      </div>
    </SettingsPage>
  )
}
