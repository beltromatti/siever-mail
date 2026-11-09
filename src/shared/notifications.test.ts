import { describe, expect, it } from 'vitest'

import { DEFAULT_NOTIFICATION_PREFERENCES, notificationPreferencesOf } from './notifications'

describe('the notifications’ preferences', () => {
  it('takes the defaults for what is not there or not well formed', () => {
    expect(notificationPreferencesOf(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    expect(
      notificationPreferencesOf({
        badge: 'many',
        calendar: { defaultLead: 7, reminders: 'yes' },
        mail: { mutedAccountIds: ['a', 'a', 3, ''] }
      })
    ).toMatchObject({
      badge: 'work',
      calendar: { defaultLead: 10, reminders: true },
      mail: { mutedAccountIds: ['a'] }
    })
  })

  it('carries over the mail’s own record of the versions before 2.0', () => {
    expect(
      notificationPreferencesOf({
        enabled: false,
        mutedAccountIds: ['a1'],
        showPreview: false,
        onlyImportant: false,
        sound: false,
        badge: false
      })
    ).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      // Its switch was the mail's: the reminders and the Segretario, new, are on.
      showPreview: false,
      sound: false,
      badge: 'none',
      mail: { enabled: false, onlyFlagged: false, mutedAccountIds: ['a1'] }
    })
    expect(notificationPreferencesOf({ badge: true }).badge).toBe('work')
  })

  it('keeps a lead of none', () => {
    expect(
      notificationPreferencesOf({ calendar: { defaultLead: null } }).calendar.defaultLead
    ).toBe(null)
  })
})
