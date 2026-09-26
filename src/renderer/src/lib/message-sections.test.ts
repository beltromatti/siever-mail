import { describe, expect, it } from 'vitest'

import { buildMessageSections, resolveSectionKind } from './message-sections'
import type { MailMessageSummary } from '@shared/models'

const NOW = new Date('2026-09-10T12:00:00.000Z')

function message(overrides: Partial<MailMessageSummary> & { uid: number }): MailMessageSummary {
  return {
    accountId: 'acc',
    folderPath: 'INBOX',
    subject: 'Oggetto',
    from: [],
    to: [],
    cc: [],
    date: NOW.toISOString(),
    preview: '',
    previewHydrated: true,
    flags: [],
    isRead: true,
    isFlagged: false,
    hasAttachments: false,
    size: 0,
    senderName: 'Mittente',
    senderKey: 'mittente@example.com',
    senderLabel: 'Mittente',
    ...overrides
  }
}

describe('resolveSectionKind', () => {
  it('never groups when the mode is none', () => {
    expect(resolveSectionKind('none', 'date')).toBe('none')
    expect(resolveSectionKind('none', 'sender')).toBe('none')
  })

  it('follows the sort in auto mode', () => {
    expect(resolveSectionKind('auto', 'date')).toBe('date')
    expect(resolveSectionKind('auto', 'sender')).toBe('sender')
    expect(resolveSectionKind('auto', 'subject')).toBe('none')
    expect(resolveSectionKind('auto', 'size')).toBe('none')
  })

  it('groups by sender under any sort, because the query orders by sender first', () => {
    expect(resolveSectionKind('sender', 'date')).toBe('sender')
    expect(resolveSectionKind('sender', 'subject')).toBe('sender')
  })
})

describe('buildMessageSections', () => {
  it('returns nothing for an empty page', () => {
    expect(buildMessageSections([], 'auto', 'date', NOW)).toEqual([])
  })

  it('returns one unlabelled section when ungrouped', () => {
    const sections = buildMessageSections(
      [message({ uid: 1 }), message({ uid: 2 })],
      'none',
      'date',
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('')
    expect(sections[0].messages).toHaveLength(2)
  })

  it('buckets by Oggi / Ieri / settimana / mese / mese-anno', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, date: '2026-09-10T09:00:00.000Z' }),
        message({ uid: 2, date: '2026-09-09T09:00:00.000Z' }),
        message({ uid: 3, date: '2026-09-08T09:00:00.000Z' }),
        message({ uid: 4, date: '2026-09-02T09:00:00.000Z' }),
        message({ uid: 5, date: '2026-07-15T09:00:00.000Z' })
      ],
      'auto',
      'date',
      NOW
    )

    expect(sections.map((section) => section.label)).toEqual([
      'Oggi',
      'Ieri',
      'Questa settimana',
      'Questo mese',
      'Luglio 2026'
    ])
  })

  it('files a future-dated message with today rather than below the page', () => {
    const sections = buildMessageSections(
      [message({ uid: 1, date: '2026-09-30T09:00:00.000Z' })],
      'auto',
      'date',
      NOW
    )
    expect(sections[0].label).toBe('Oggi')
  })

  it('keeps consecutive same-day messages in one section', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, date: '2026-09-10T09:00:00.000Z' }),
        message({ uid: 2, date: '2026-09-10T08:00:00.000Z' })
      ],
      'auto',
      'date',
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].messages).toHaveLength(2)
  })

  it('groups by the name each address is filed under, not by header spelling', () => {
    const sections = buildMessageSections(
      [
        message({
          uid: 1,
          senderName: 'M. Rossi',
          senderKey: 'm.rossi@example.com',
          senderLabel: 'Mario Rossi'
        }),
        message({
          uid: 2,
          senderName: 'm.rossi@example.com',
          senderKey: 'm.rossi@example.com',
          senderLabel: 'Mario Rossi'
        }),
        message({
          uid: 3,
          senderName: 'Mario Rossi',
          senderKey: 'mario@rossi.example.org',
          senderLabel: 'Mario Rossi'
        }),
        message({
          uid: 4,
          senderName: 'Bianchi',
          senderKey: 'bianchi@example.org',
          senderLabel: 'Bianchi'
        })
      ],
      'sender',
      'date',
      NOW
    )

    expect(sections.map((section) => [section.label, section.messages.length])).toEqual([
      ['Mario Rossi', 3],
      ['Bianchi', 1]
    ])
  })

  it('keeps spellings of one name in one section, titled as most messages spell it', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, senderKey: 'a.beltrami@siever.it', senderLabel: 'A.beltrami-SIEVER' }),
        message({ uid: 2, senderKey: 'a.beltrami@siever.it', senderLabel: 'A. Beltrami - SIEVER' }),
        message({ uid: 3, senderKey: 'a.beltrami@siever.it', senderLabel: 'A. Beltrami - SIEVER' })
      ],
      'auto',
      'sender',
      NOW
    )

    expect(sections.map((section) => [section.label, section.messages.length])).toEqual([
      ['A. Beltrami - SIEVER', 3]
    ])
  })

  it('opens a section per sender when auto grouping meets a sender sort', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, senderKey: 'a@example.com', senderLabel: 'Anna' }),
        message({ uid: 2, senderKey: 'a@example.com', senderLabel: 'Anna' }),
        message({ uid: 3, senderKey: 'b@example.com', senderLabel: 'Bruno' })
      ],
      'auto',
      'sender',
      NOW
    )

    expect(sections.map((section) => [section.kind, section.label])).toEqual([
      ['sender', 'Anna'],
      ['sender', 'Bruno']
    ])
  })

  it('gives every run a unique key even when a sender repeats', () => {
    // Happens between changing the grouping and the re-ordered page landing:
    // the list is grouped by sender while the rows are still date-ordered.
    // Duplicate keys here used to break React's reconciliation and strand
    // heading elements in the DOM permanently.
    const sections = buildMessageSections(
      [
        message({ uid: 1, senderLabel: 'LinkedIn', senderKey: 'a@linkedin.com' }),
        message({ uid: 2, senderLabel: 'Amazon', senderKey: 'b@amazon.it' }),
        message({ uid: 3, senderLabel: 'LinkedIn', senderKey: 'a@linkedin.com' })
      ],
      'sender',
      'date',
      NOW
    )

    expect(sections).toHaveLength(3)
    expect(sections.map((section) => section.label)).toEqual(['LinkedIn', 'Amazon', 'LinkedIn'])
    expect(new Set(sections.map((section) => section.key)).size).toBe(3)
  })

  it('counts unread messages per section', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, isRead: false }),
        message({ uid: 2, isRead: true }),
        message({ uid: 3, isRead: false })
      ],
      'none',
      'date',
      NOW
    )
    expect(sections[0].unreadCount).toBe(2)
  })

  it('stays one flat run when auto grouping meets a subject sort', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, date: '2026-09-10T09:00:00.000Z' }),
        message({ uid: 2, date: '2026-07-15T09:00:00.000Z' })
      ],
      'auto',
      'subject',
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('')
  })
})
