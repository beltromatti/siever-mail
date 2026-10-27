import { accountOverview, type OverviewPerson } from '../mail-overview'
import { PROMPTS } from '../prompts'
import { numberArg, stringArg, ToolInputError, type SegretarioTool } from '../agent/tool-types'
import { countOf, shortDate } from './format'

const DEFAULT_MONTHS = 12
const MAX_MONTHS = 60
const DEFAULT_PEOPLE = 20
const MAX_PEOPLE = 60

const MONTH_LABEL = new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric' })

function personLine(person: OverviewPerson): string {
  const who = person.name ? `${person.name} <${person.address}>` : person.address
  const answered =
    person.answered === undefined
      ? ''
      : person.answered === 0
        ? ' · mai risposto'
        : ` · hai risposto a ${person.answered}`

  return `- ${who} · ${countOf(person.messages, 'messaggio', 'messaggi')}${answered} · ultimo ${shortDate(person.lastIso.slice(0, 10))}`
}

export const overviewTool: SegretarioTool = {
  name: 'panoramica',
  description: PROMPTS.tools.panoramica,
  parameters: {
    type: 'object',
    properties: {
      account: { type: 'string' },
      mesi: { type: 'integer', minimum: 1, maximum: MAX_MONTHS },
      persone: { type: 'integer', minimum: 1, maximum: MAX_PEOPLE }
    }
  },
  running: (args) => {
    const account = stringArg(args, 'account')
    return account
      ? `Guardo la posta di ${account} nel suo insieme…`
      : 'Guardo la posta nel suo insieme…'
  },
  async execute(args, context) {
    const accounts = await context.mail.listAccounts()
    const wanted = stringArg(args, 'account')?.toLowerCase()
    const chosen = wanted
      ? accounts.filter((account) => account.email.toLowerCase() === wanted)
      : accounts

    if (chosen.length === 0) {
      throw new ToolInputError(
        `Nessun account «${wanted}». Gli account sono: ${accounts.map((account) => account.email).join(', ')}.`
      )
    }

    const months = Math.min(MAX_MONTHS, Math.max(1, numberArg(args, 'mesi') ?? DEFAULT_MONTHS))
    const people = Math.min(MAX_PEOPLE, Math.max(1, numberArg(args, 'persone') ?? DEFAULT_PEOPLE))
    const since = new Date()
    since.setMonth(since.getMonth() - months)
    const sinceIso = since.toISOString()
    // Mail between the user's own accounts is theirs on both sides.
    const own = new Set(accounts.map((account) => account.email.toLowerCase()))
    const prisma = await context.mail.searchClient()
    const sections: string[] = []

    for (const account of chosen) {
      const overview = await accountOverview(
        prisma,
        account,
        await context.mail.listFolders(account.id),
        own,
        sinceIso,
        people
      )

      sections.push(
        [
          `## ${account.email} — ultimi ${countOf(months, 'mese', 'mesi')} (dal ${shortDate(sinceIso.slice(0, 10))})`,
          `Scritti dall'utente: ${overview.sent} · ricevuti: ${overview.received}`,
          '',
          "A chi scrive di più l'utente:",
          ...(overview.writtenTo.length > 0
            ? overview.writtenTo.map(personLine)
            : ['- nessuno in questo periodo']),
          '',
          "Chi scrive di più all'utente:",
          ...(overview.writers.length > 0
            ? overview.writers.map(personLine)
            : ['- nessuno in questo periodo']),
          '',
          'Mese per mese (scritti / ricevuti):',
          overview.months
            .map(
              (month) =>
                `${MONTH_LABEL.format(new Date(Number(month.month.slice(0, 4)), Number(month.month.slice(5, 7)) - 1, 1))} ${month.sent}/${month.received}`
            )
            .join(' · ') || '—'
        ].join('\n')
      )
    }

    return {
      content: sections.join('\n\n'),
      summary: `Guardata la posta ${chosen.length === 1 ? `di ${chosen[0].email}` : 'di tutti gli account'} · ultimi ${countOf(months, 'mese', 'mesi')}`
    }
  }
}
