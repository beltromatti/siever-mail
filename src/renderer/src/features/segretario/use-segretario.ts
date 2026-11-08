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
  /** The one switch, as the user set it; null while loading. */
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
  /** OpenRouter does not answer: what runs waits for it, and says until when (§14.1). */
  waiting: string | null
  select(id: string | null): void
  start(text: string, context: SegretarioContext): Promise<void>
  send(text: string, context: SegretarioContext): Promise<void>
  /** A request that stopped short, taken up again from where it was (§14.2). */
  retry(id: string): Promise<void>
  cancel(id: string): void
  remove(id: string): Promise<void>
  resolveApproval(
    activityId: string,
    approvalId: string,
    approved: boolean,
    outcome?: Parameters<typeof window.segretarioApi.resolveApproval>[3]
  ): Promise<void>
  refreshStatus(): Promise<void>
  /** The work it did on its own, the latest first; null until asked for. */
  diary: ActivitySummary[] | null
  loadDiary(): Promise<void>
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
 * Whether OpenRouter answers: while it does not, what the Segretario does
 * waits for it — a request, a rewrite — and this says until when (§14.1).
 */
export function useAiWaiting(): string | null {
  const [waiting, setWaiting] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void window.segretarioApi
      .getEngineState()
      .then((engine) => current && setWaiting(engine.waiting))
      .catch(() => undefined)
    const unsubscribe = window.segretarioApi.onEngineChanged((engine) => setWaiting(engine.waiting))

    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  return waiting
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
  const [diary, setDiary] = useState<ActivitySummary[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null)
  // What the activity on screen is writing, as it writes: only that one's, so the work done
  // alone, step after step, does not redraw the app.
  const [stream, setStream] = useState<{ id: string; text: string } | null>(null)
  const waiting = useAiWaiting()
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
    const offPreferences = window.segretarioApi.onPreferencesChanged(setPreferences)
    const offEvents = window.segretarioApi.onActivityEvent((event) => {
      switch (event.type) {
        case 'summary': {
          // The panel lists the user's requests and Conoscimi; the diary, the work done alone.
          const upsert = (current: ActivitySummary[]): ActivitySummary[] =>
            sortActivities([
              ...current.filter((activity) => activity.id !== event.activity.id),
              event.activity
            ])

          if (event.activity.visibility === 'pannello') {
            setActivities(upsert)
          } else if (event.activity.visibility === 'diario') {
            setDiary((current) => (current ? upsert(current) : current))
          }

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
          if (event.activityId === selectedRef.current) {
            setStream((current) =>
              current?.id === event.activityId && current.text === event.text
                ? current
                : { id: event.activityId, text: event.text }
            )
          }
          break
        case 'removed':
          setActivities((current) => current.filter((activity) => activity.id !== event.activityId))
          setDiary(
            (current) => current?.filter((activity) => activity.id !== event.activityId) ?? null
          )

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
      offPreferences()
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

  const loadDiary = useCallback(async (): Promise<void> => {
    const all = await window.segretarioApi.listActivities({ diary: true })
    setDiary(sortActivities(all.filter((activity) => activity.visibility === 'diario')))
  }, [])

  const refreshStatus = useCallback(
    async (): Promise<void> => setStatus(await window.segretarioApi.checkKey()),
    []
  )
  const streaming = selectedId && stream?.id === selectedId ? stream.text : ''
  // Something waits for the user: an answer, work not looked at.
  const attention = activities.some((activity) => activity.status === 'waiting' || activity.unseen)

  // The same object while nothing in it changes: what depends on it is not redrawn.
  return useMemo(
    () => ({
      status,
      preferences,
      activities,
      selectedId,
      entries,
      streaming,
      handles,
      attention,
      select,
      waiting,
      start,
      send,
      retry: retryActivity,
      cancel: cancelActivity,
      remove: removeActivity,
      resolveApproval: resolveActivityApproval,
      refreshStatus,
      diary,
      loadDiary
    }),
    [
      status,
      preferences,
      activities,
      selectedId,
      entries,
      streaming,
      handles,
      attention,
      waiting,
      select,
      start,
      send,
      refreshStatus,
      diary,
      loadDiary
    ]
  )
}

async function retryActivity(id: string): Promise<void> {
  await window.segretarioApi.retryActivity(id)
}

function cancelActivity(id: string): void {
  void window.segretarioApi.cancelActivity(id)
}

function removeActivity(id: string): Promise<void> {
  return window.segretarioApi.removeActivity(id)
}

function resolveActivityApproval(
  activityId: string,
  approvalId: string,
  approved: boolean,
  outcome?: Parameters<typeof window.segretarioApi.resolveApproval>[3]
): Promise<void> {
  return window.segretarioApi.resolveApproval(activityId, approvalId, approved, outcome)
}
