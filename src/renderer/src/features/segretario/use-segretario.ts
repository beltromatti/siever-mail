import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  ActivityEntry,
  ActivitySummary,
  HandleLink,
  SegretarioContext,
  SegretarioPreferences,
  SegretarioStatus
} from '@shared/segretario'

export interface SegretarioState {
  status: SegretarioStatus | null
  /** What it does on its own, as the user set it; null while loading. */
  preferences: SegretarioPreferences | null
  activities: ActivitySummary[]
  /** The activity on screen, null for a new one. */
  selectedId: string | null
  /** Its entries, once loaded. */
  entries: ActivityEntry[] | null
  /** What the Segretario is writing now in the activity on screen. */
  streaming: string
  /** The short names of the activity on screen, to make links of. */
  handles: ReadonlyMap<string, HandleLink>
  /** An activity is waiting for the user, or finished unseen: the rail says so. */
  attention: boolean
  select(id: string | null): void
  start(text: string, context: SegretarioContext): Promise<void>
  send(text: string, context: SegretarioContext): Promise<void>
  cancel(id: string): void
  remove(id: string): Promise<void>
  resolveApproval(
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: Parameters<typeof window.segretarioApi.resolveApproval>[3]
  ): Promise<void>
  refreshStatus(): Promise<void>
  /** The user's answer to getting to know them. */
  setLearning(learning: boolean): Promise<void>
}

function sortActivities(activities: ActivitySummary[]): ActivitySummary[] {
  return [...activities].sort((a, b) => b.updatedAt - a.updatedAt)
}

function upsertEntry(entries: ActivityEntry[], entry: ActivityEntry): ActivityEntry[] {
  const index = entries.findIndex((item) => item.id === entry.id)

  if (index < 0) {
    return [...entries, entry].sort((a, b) => a.id - b.id)
  }

  const next = [...entries]
  next[index] = entry
  return next
}

/**
 * The Segretario as the page sees it: the key's state, the activities and
 * the one on screen, kept in step with the main process's events. `visible`
 * says whether the panel is open: an activity on screen while it is, is
 * seen.
 */
export function useSegretario(visible: boolean): SegretarioState {
  const [status, setStatus] = useState<SegretarioStatus | null>(null)
  const [preferences, setPreferences] = useState<SegretarioPreferences | null>(null)
  const [activities, setActivities] = useState<ActivitySummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  const [streams, setStreams] = useState<Record<string, string>>({})
  const selectedRef = useRef<string | null>(null)
  const visibleRef = useRef(visible)

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    void window.segretarioApi.getStatus().then(setStatus)
    void window.segretarioApi.getPreferences().then(setPreferences)
    void window.segretarioApi.listActivities().then((list) => setActivities(sortActivities(list)))

    const offStatus = window.segretarioApi.onStatusChanged(setStatus)
    const offEvents = window.segretarioApi.onActivityEvent((event) => {
      switch (event.type) {
        case 'summary': {
          setActivities((current) =>
            sortActivities([
              ...current.filter((activity) => activity.id !== event.activity.id),
              event.activity
            ])
          )

          if (
            event.activity.unseen &&
            visibleRef.current &&
            event.activity.id === selectedRef.current
          ) {
            void window.segretarioApi.markActivitySeen(event.activity.id)
          }
          break
        }
        case 'entry':
          if (event.activityId === selectedRef.current) {
            setEntries((current) => (current ? upsertEntry(current, event.entry) : current))
          }
          break
        case 'stream':
          setStreams((current) => ({ ...current, [event.activityId]: event.text }))
          break
        case 'removed':
          setActivities((current) => current.filter((activity) => activity.id !== event.activityId))

          if (selectedRef.current === event.activityId) {
            selectedRef.current = null
            setSelectedId(null)
            setEntries(null)
          }
          break
      }
    })

    return () => {
      offStatus()
      offEvents()
    }
  }, [])

  const select = useCallback((id: string | null): void => {
    selectedRef.current = id
    setSelectedId(id)
    setEntries(id ? null : [])

    if (!id) {
      return
    }

    void window.segretarioApi.getActivity(id).then((detail) => {
      if (selectedRef.current === id) {
        setEntries(detail?.entries ?? [])
      }
    })
    void window.segretarioApi.markActivitySeen(id)
  }, [])

  // Opening the panel on an activity finished meanwhile marks it seen.
  useEffect(() => {
    const activity = activities.find((item) => item.id === selectedId)

    if (visible && activity?.unseen) {
      void window.segretarioApi.markActivitySeen(activity.id)
    }
  }, [activities, selectedId, visible])

  const start = useCallback(
    async (text: string, context: SegretarioContext): Promise<void> => {
      const summary = await window.segretarioApi.startActivity(text, context)
      setActivities((current) =>
        sortActivities([...current.filter((activity) => activity.id !== summary.id), summary])
      )
      select(summary.id)
    },
    [select]
  )

  const send = useCallback(
    async (text: string, context: SegretarioContext): Promise<void> => {
      if (!selectedRef.current) {
        await start(text, context)
        return
      }

      await window.segretarioApi.sendMessage(selectedRef.current, text, context)
    },
    [start]
  )

  const handles = useMemo(() => {
    const map = new Map<string, HandleLink>()

    for (const entry of entries ?? []) {
      if (entry.kind === 'tool' || entry.kind === 'user') {
        for (const link of entry.handles) {
          map.set(link.handle, link)
        }
      }
    }

    return map
  }, [entries])

  const setLearning = useCallback(
    async (learning: boolean): Promise<void> => {
      const current = preferences ?? (await window.segretarioApi.getPreferences())
      setPreferences(await window.segretarioApi.setPreferences({ ...current, learning }))
    },
    [preferences]
  )

  return {
    status,
    preferences,
    activities,
    selectedId,
    entries,
    streaming: selectedId ? (streams[selectedId] ?? '') : '',
    handles,
    attention: activities.some((activity) => activity.status === 'waiting' || activity.unseen),
    select,
    start,
    send,
    cancel: (id) => void window.segretarioApi.cancelActivity(id),
    remove: async (id) => window.segretarioApi.removeActivity(id),
    resolveApproval: async (activityId, approvalId, approved, outcome) =>
      window.segretarioApi.resolveApproval(activityId, approvalId, approved, outcome),
    refreshStatus: async () => setStatus(await window.segretarioApi.checkKey()),
    setLearning
  }
}
