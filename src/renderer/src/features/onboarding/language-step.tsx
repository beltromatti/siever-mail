import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { chooseLanguage, useLanguage, useMessages } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { defineMessages, LANGUAGE_NAMES, LANGUAGES, type Language } from '@shared/i18n'
import { PLACES } from '@shared/places'

import { StepFrame } from './step-frame'

const MESSAGES = defineMessages({
  title: { en: 'Your language', it: 'La tua lingua', de: 'Ihre Sprache' },
  lead: {
    en: (settings: string, preferences: string) =>
      `The language SIEVER Mail speaks to you in. You can change it whenever you like, in ${settings} › ${preferences}.`,
    it: (settings: string, preferences: string) =>
      `La lingua in cui SIEVER Mail ti parla. La cambi quando vuoi, in ${settings} › ${preferences}.`,
    de: (settings: string, preferences: string) =>
      `Die Sprache, in der SIEVER Mail mit Ihnen spricht. Sie können sie jederzeit unter ${settings} › ${preferences} ändern.`
  },
  segretario: {
    en: 'The Segretario writes to you in your own language, even if it is another.',
    it: 'Il Segretario ti scrive nella tua lingua, anche se è un’altra.',
    de: 'Der Segretario schreibt Ihnen in Ihrer eigenen Sprache, auch wenn es eine andere ist.'
  },
  system: { en: 'Your computer’s', it: 'Quella del computer', de: 'Die Ihres Computers' },
  continue: { en: 'Continue', it: 'Continua', de: 'Weiter' }
})

/** Each language's name in the interface's language, under its own. */
const NAMES = defineMessages({
  en: { en: 'English', it: 'Inglese', de: 'Englisch' },
  it: { en: 'Italian', it: 'Italiano', de: 'Italienisch' },
  de: { en: 'German', it: 'Tedesco', de: 'Deutsch' }
}) satisfies Record<Language, unknown>

/**
 * Step 0 of a first start: the language, before anything else (vision
 * §12.2, §13.5). Choosing one turns the interface to it at once — this
 * step too —, so what follows is read in it; the computer's own language,
 * when SIEVER Mail speaks it, is pointed out.
 */
export function LanguageStep({ onNext }: { onNext: () => void }): React.JSX.Element {
  const m = useMessages(MESSAGES)
  const names = useMessages(NAMES)
  const places = useMessages(PLACES)
  const { language } = useLanguage()
  const [system, setSystem] = useState<Language | null>(null)

  useEffect(() => {
    let current = true
    void window.languageApi
      ?.systemLanguage()
      .then((found) => current && setSystem(found))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  return (
    <StepFrame
      title={m.title}
      lead={`${m.lead(places.settings, places.preferences)} ${m.segretario}`}
      actions={
        <Button size="lg" onClick={onNext}>
          {m.continue}
        </Button>
      }
    >
      <div role="radiogroup" aria-label={m.title} className="flex flex-col gap-2">
        {LANGUAGES.map((option) => {
          const chosen = option === language

          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={chosen}
              lang={option}
              onClick={() => void chooseLanguage(option)}
              className={cn(
                'focus-visible:ring-ring/60 flex items-center gap-3 rounded-[10px] border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2',
                chosen ? 'border-primary bg-selected' : 'border-border hover:bg-hover'
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">{LANGUAGE_NAMES[option]}</span>
                {names[option] !== LANGUAGE_NAMES[option] && (
                  <span className="text-muted-foreground text-[12px]" lang={language}>
                    {names[option]}
                  </span>
                )}
              </span>
              {system === option && (
                <span className="text-muted-foreground text-[11px]" lang={language}>
                  {m.system}
                </span>
              )}
              <Check
                aria-hidden
                className={cn('text-primary size-4 shrink-0', !chosen && 'invisible')}
              />
            </button>
          )
        })}
      </div>
    </StepFrame>
  )
}
