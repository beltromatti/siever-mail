import { ExternalLink } from 'lucide-react'

import extensionShared from '@app/extension/shared'
import { Button } from '@renderer/components/ui/button'
import { formatAppVersion } from '@renderer/lib/utils'

/** Where SIEVER Mail lives, and its developers can be reached. */
const PROJECT_PAGE = 'https://github.com/beltromatti/siever-mail'

/**
 * Settings › Estensione: the extension built into this installation, made
 * for an organisation and named after it — or none, with how to have one.
 */
export function ExtensionSection(): React.JSX.Element {
  const identity = extensionShared.identity

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      {identity ? (
        <div className="settings-group">
          <p className="eyebrow">Installata</p>
          <p className="mt-1 text-[14px] font-semibold">{identity.name}</p>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
            {identity.description}
          </p>
          <p className="text-faint-foreground mt-2 text-[11.5px]">
            {identity.id} · in SIEVER Mail {formatAppVersion(__APP_VERSION__)}
          </p>
        </div>
      ) : (
        <div className="settings-group">
          <p className="eyebrow">Nessuna estensione</p>
          <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
            Questa è l’edizione di SIEVER Mail per tutti: funziona da sola, e impara il tuo lavoro
            da ciò che vede.
          </p>
        </div>
      )}

      <div className="settings-group">
        <p className="eyebrow">Che cos’è un’estensione</p>
        <p className="text-muted-foreground mt-1 max-w-[62ch] text-[12.5px] leading-relaxed">
          Un’estensione fa SIEVER Mail su misura di un’organizzazione — un’azienda, uno studio, un
          professionista — e porta il suo nome. Dice al Segretario come lavora quella realtà, come
          chiama le cose e dove le tiene; gli dà strumenti suoi; aggiunge all’app le azioni che
          servono a quel lavoro. Non cambia ciò che SIEVER Mail è: lo completa.
        </p>
        {!identity && (
          <>
            <p className="text-muted-foreground mt-2 max-w-[62ch] text-[12.5px] leading-relaxed">
              Per avere un’estensione per il tuo lavoro, contatta gli sviluppatori.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 w-fit gap-2"
              onClick={() => void window.mailApi.openExternalUrl(PROJECT_PAGE)}
            >
              <ExternalLink className="size-3.5" />
              La pagina del progetto
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
