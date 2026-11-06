/**
 * The original as a reply or a forward quotes it, the way Gmail writes it:
 * the attribution line or the forwarded headers, then the message in a
 * `gmail_quote` block. The mail's own replies and the Segretario's drafts
 * (see `composerDataFor` in `App`) quote the same way.
 */
import { inlineMessageStyles } from '@renderer/lib/inline-message-styles'
import type { MailMessageDetail } from '@shared/models'

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

  return new Intl.DateTimeFormat('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
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
  const sender = message.from[0]
  const senderLabel = sender ? formatQuotedAddress(sender) : 'Mittente sconosciuto'
  const attributionLine = `Il giorno ${formatQuotedDate(message.date)} ${senderLabel} ha scritto:`
  const quotedBody = await quotedMessageBody(message)

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attributionLine}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}

export async function buildForwardQuoteHtml(message: MailMessageDetail): Promise<string> {
  const quotedBody = await quotedMessageBody(message)
  const fromHeader = message.from.length > 0 ? formatQuotedAddressList(message.from) : 'N/D'
  const toHeader = message.to.length > 0 ? formatQuotedAddressList(message.to) : 'N/D'
  const ccHeader = message.cc.length > 0 ? `<br>Cc: ${formatQuotedAddressList(message.cc)}` : ''

  return `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Messaggio inoltrato ----------<br>Da: ${fromHeader}<br>Data: ${escapeHtml(formatQuotedDate(message.date))}<br>Oggetto: ${escapeHtml(message.subject)}<br>A: ${toHeader}${ccHeader}<br></div><blockquote class="gmail_quote" type="cite" style="${GMAIL_QUOTE_BLOCK_STYLE}">${quotedBody}</blockquote></div>`
}
