import { defineMessages } from '@shared/i18n'

import { languageState, messages } from '../../i18n'
import type { DateWords } from './format'

const WORDS = defineMessages({
  allDay: { en: 'all day', it: 'tutto il giorno', de: 'ganztägig' }
})

/**
 * How the lines the user sees write dates — a step's, a confirmation's,
 * an activity's title (vision §13.5): in the interface's language, as the
 * computer's region orders them. What the model reads keeps `MODEL_DATES`.
 */
export function userDates(): DateWords {
  return { locale: languageState().formatLocale, allDay: messages(WORDS).allDay }
}
