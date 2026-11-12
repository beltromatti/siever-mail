/**
 * The original as a reply or a forward quotes it, the way Gmail writes it:
 * the attribution line or the forwarded headers, then the message in a
 * `gmail_quote` block. The mail's own replies and the Segretario's drafts
 * (see `composerDataFor` in `App`) quote the same way.
 */
import { hourStyle, languageNow, messagesNow } from '@renderer/lib/i18n'
import { inlineMessageStyles } from '@renderer/lib/inline-message-styles'
import { defineMessages } from '@shared/i18n'
import type { MailMessageDetail } from '@shared/models'

/**
 * Words that go out with the message, in the interface's language when it
 * is written — as every client writes its own.
 */
const MESSAGES = defineMessages({
  unknownSender: {
    en: 'Unknown sender',
    it: 'Mittente sconosciuto',
    de: 'Unbekannter Absender'
  },
  attribution: {
    en: (date: string, sender: string) => `On ${date}, ${sender} wrote:`,
    it: (date: string, sender: string) => `Il giorno ${date} ${sender} ha scritto:`,
    de: (date: string, sender: string) => `Am ${date} schrieb ${sender}:`
  },
  forwardedMessage: {
    en: '---------- Forwarded message ---------',
    it: '---------- Messaggio inoltrato ----------',
    de: '---------- Weitergeleitete Nachricht ----------'
  },
  from: { en: 'From', it: 'Da', de: 'Von' },
  date: { en: 'Date', it: 'Data', de: 'Datum' },
  subject: { en: 'Subject', it: 'Oggetto', de: 'Betreff' },
  to: { en: 'To', it: 'A', de: 'An' },
  cc: { en: 'Cc', it: 'Cc', de: 'Cc' },
  notAvailable: { en: 'n/a', it: 'N/D', de: 'k. A.' }
})

const GMAIL_QUOTE_BLOCK_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex'

function htmlFromText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br />')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatQuotedAddress(address: { name?: string; address: string }): string {
  const email = escapeHtml(address.address.trim())
  const displayName = (address.name ?? '').trim()

  if (!displayName) {
    return email
  }

  return `${escapeHtml(displayName)} &lt;${email}&gt;`
}

function formatQuotedAddressList(addresses: Array<{ name?: string; address: string }>): string {
  return addresses.map(formatQuotedAddress).join(', ')
}

function formatQuotedDate(dateIso: string): string {
  const date = new Date(dateIso)

  if (Number.isNaN(date.valueOf())) {
    return dateIso
  }

  return new Intl.DateTimeFormat(languageNow().formatLocale, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: hourStyle(),
    minute: '2-digit'
  }).format(date)
}

/**
 * The message as the reader shows it, ready to quote: its style sheets
 * written onto its elements (see `inlineMessageStyles`), so the composer
 * shows it as it was read and it goes out that way.
 */
async function quotedMessageBody(message: MailMessageDetail): Promise<string> {
  return message.html ? inlineMessageStyles(message.html) : htmlFromText(message.text || '')
}

export async function buildReplyQuoteHtml(message: MailMessageDetail): Promise<string> {
  const m = messagesNow(MESSAGES)
  const sender = message.from[0]
  const senderLabel = sender ? formatQuotedAddress(sender) : escapeHtml(m.unknownSender)
  const attributionLine = m.attribution(escapeHtml(formatQuotedDate(message.date)), senderLabel)
  const quotedBody = await quotedMessageBody(message)

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attributionLine}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

export async function buildForwardQuoteHtml(message: MailMessageDetail): Promise<string> {
  // Read before the wait: the words of the moment the forward was asked for.
  const m = messagesNow(MESSAGES)
  const date = escapeHtml(formatQuotedDate(message.date))
  const quotedBody = await quotedMessageBody(message)
  const notAvailable = escapeHtml(m.notAvailable)
  const fromHeader = message.from.length > 0 ? formatQuotedAddressList(message.from) : notAvailable
  const toHeader = message.to.length > 0 ? formatQuotedAddressList(message.to) : notAvailable
  const ccHeader =
    message.cc.length > 0 ? `<br>${m.cc}: ${formatQuotedAddressList(message.cc)}` : ''

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${m.forwardedMessage}<br>${m.from}: ${fromHeader}<br>${m.date}: ${date}<br>${m.subject}: ${escapeHtml(message.subject)}<br>${m.to}: ${toHeader}${ccHeader}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}
