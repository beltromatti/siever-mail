import { describe, expect, it } from 'vitest'

import { buildMessageSections, isGroupingApplicable } from './message-sections'
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
    senderKey: 'mittente@siever.it',
    ...overrides
  }
}

describe('isGroupingApplicable', () => {
  it('never groups when the mode is none', () => {
    expect(isGroupingApplicable('none', 'date')).toBe(false)
  })

  it('only buckets by date while the list is ordered by date', () => {
    expect(isGroupingApplicable('date', 'date')).toBe(true)
    expect(isGroupingApplicable('date', 'subject')).toBe(false)
    expect(isGroupingApplicable('date', 'sender')).toBe(false)
  })

  it('groups by sender under any sort, because the query orders by sender first', () => {
    expect(isGroupingApplicable('sender', 'date')).toBe(true)
    expect(isGroupingApplicable('sender', 'subject')).toBe(true)
  })
})

describe('buildMessageSections', () => {
  it('returns nothing for an empty page', () => {
    expect(buildMessageSections([], 'date', 'date', NOW)).toEqual([])
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
      'date',
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
      'date',
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
      'date',
      'date',
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].messages).toHaveLength(2)
  })

  it('groups by sender key, not by display name spelling', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, senderName: 'A. Beltrami', senderKey: 'a.beltrami@siever.it' }),
        message({ uid: 2, senderName: 'Alessandro Beltrami', senderKey: 'a.beltrami@siever.it' }),
        message({ uid: 3, senderName: 'Marconi', senderKey: 'marconi@sevenarchitettura.com' })
      ],
      'sender',
      'date',
      NOW
    )

    expect(sections).toHaveLength(2)
    expect(sections[0].label).toBe('A. Beltrami')
    expect(sections[0].messages).toHaveLength(2)
    expect(sections[1].label).toBe('Marconi')
  })

  it('gives every run a unique key even when a sender repeats', () => {
    // Happens between changing the grouping and the re-ordered page landing:
    // the list is grouped by sender while the rows are still date-ordered.
    // Duplicate keys here used to break React's reconciliation and strand
    // heading elements in the DOM permanently.
    const sections = buildMessageSections(
      [
        message({ uid: 1, senderName: 'LinkedIn', senderKey: 'a@linkedin.com' }),
        message({ uid: 2, senderName: 'Amazon', senderKey: 'b@amazon.it' }),
        message({ uid: 3, senderName: 'LinkedIn', senderKey: 'a@linkedin.com' })
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

  it('falls back to a flat list when date grouping cannot apply', () => {
    const sections = buildMessageSections(
      [
        message({ uid: 1, date: '2026-09-10T09:00:00.000Z' }),
        message({ uid: 2, date: '2026-07-15T09:00:00.000Z' })
      ],
      'date',
      'subject',
      NOW
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('')
  })
})
