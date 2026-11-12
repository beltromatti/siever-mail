import { useEffect, useState } from 'react'
import { LogIn, Plus } from 'lucide-react'

import appLogo from '@renderer/assets/logo.png'
import { Button } from '@renderer/components/ui/button'
import { useMessages } from '@renderer/lib/i18n'
import { cn, formatAppVersion } from '@renderer/lib/utils'
import { defineMessages } from '@shared/i18n'
import type { OnboardingCase } from '@shared/segretario'

const MESSAGES = defineMessages({
  logo: { en: 'SIEVER Mail logo', it: 'Logo SIEVER Mail', de: 'SIEVER-Mail-Logo' },
  tagline: {
    en: 'Your personal operating system',
    it: 'Il tuo sistema operativo personale',
    de: 'Ihr persönliches Betriebssystem'
  },
  enter: { en: 'Enter', it: 'Entra', de: 'Öffnen' },
  addConnection: {
    en: 'Add a connection',
    it: 'Aggiungi una connessione',
    de: 'Verbindung hinzufügen'
  },
  start: { en: 'Get started', it: 'Inizia', de: 'Los geht’s' },
  version: {
    en: (version: string) => `Version ${version}`,
    it: (version: string) => `Versione ${version}`,
    de: (version: string) => `Version ${version}`
  }
})

/**
 * The screen the app opens on: the mark, the name coming out of it, then the
 * way in — or, with no connection yet, the way to the first. It plays anew
 * each time it shows. With connections it lies over the workspace, which
 * keeps working under it; `fadeIn` when it comes back over it from the rail.
 */
export function WelcomeScreen({
  hasConnections,
  fadeIn = false,
  onEnter,
  onSetup
}: {
  hasConnections: boolean
  fadeIn?: boolean
  onEnter: () => void
  onSetup: (setupCase: OnboardingCase) => void
}): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const [step, setStep] = useState<'logo' | 'text' | 'button'>('logo')

  useEffect(() => {
    const textReveal = window.setTimeout(() => setStep('text'), 1400)
    const buttonReveal = window.setTimeout(() => setStep('button'), 2300)

    return () => {
      window.clearTimeout(textReveal)
      window.clearTimeout(buttonReveal)
    }
  }, [])

  return (
    // Nothing here to select or type in: the whole screen is the window's handle, but its buttons.
    <div
      className={cn('window-drag-region bg-background h-full w-full', fadeIn && 'welcome-enter')}
    >
      <div className="relative mx-auto h-full w-full max-w-5xl px-6 py-12">
        <div className="flex h-full items-center justify-center">
          <div
            className={cn(
              'flex items-center justify-center transition-[gap] duration-[1800ms] ease-out',
              step === 'logo' ? 'gap-0' : 'gap-4 lg:gap-5'
            )}
          >
            <img
              src={appLogo}
              alt={m.logo}
              className="size-[5.5rem] shrink-0 select-none lg:size-[6.5rem]"
              draggable={false}
            />
            <div
              className={cn(
                'overflow-hidden transition-all duration-[1800ms] ease-out',
                step === 'logo' ? 'max-w-0 opacity-0' : 'max-w-[760px] opacity-100'
              )}
            >
              <h1
                className={cn(
                  'display-title text-6xl leading-none font-black tracking-tight whitespace-nowrap transition-transform duration-[1800ms] ease-out lg:text-7xl',
                  step === 'logo' ? 'translate-x-6' : 'translate-x-0'
                )}
              >
                SIEVER Mail
                <span className="text-muted-foreground mt-2 block font-serif text-2xl leading-tight font-normal tracking-normal whitespace-nowrap italic">
                  {m.tagline}
                </span>
              </h1>
            </div>
          </div>
        </div>

        <div
          className={cn(
            'absolute inset-x-0 bottom-8 flex justify-center transition-all duration-[900ms]',
            step === 'button'
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-2 opacity-0'
          )}
        >
          <div className="window-no-drag flex flex-col items-center gap-3">
            {hasConnections ? (
              <>
                <Button className="w-56 gap-2 rounded-lg text-sm" size="lg" onClick={onEnter}>
                  <LogIn className="size-4" />
                  {m.enter}
                </Button>
                <Button
                  variant="secondary"
                  className="w-56 gap-2 rounded-lg text-sm"
                  size="lg"
                  onClick={() => onSetup('nuova-connessione')}
                >
                  <Plus className="size-4" />
                  {m.addConnection}
                </Button>
              </>
            ) : (
              <Button
                className="w-56 gap-2 rounded-lg text-sm"
                size="lg"
                onClick={() => onSetup('primo-avvio')}
              >
                <LogIn className="size-4" />
                {m.start}
              </Button>
            )}
            <p className="text-muted-foreground pt-1 text-xs tracking-[0.14em] uppercase">
              {m.version(formatAppVersion(__APP_VERSION__))}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
