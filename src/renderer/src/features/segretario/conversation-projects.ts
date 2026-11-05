import { useEffect, useRef, useState } from 'react'

import type { ProjectLabel } from '@shared/segretario'

/** Threads are asked for in batches this big. */
const THREADS_PER_REQUEST = 500

export function threadKey(message: { accountId: string; threadId: string }): string {
  return `${message.accountId}\u0000${message.threadId}`
}

/** A project as a row's tag: a name with a code ("Prat2451 · Hotel Lido") by its code, another short. */
export function projectTag(project: ProjectLabel): string {
  const code = project.title.split(' · ')[0]

  if (code !== project.title) {
    return code
  }

  return project.title.length > 24 ? `${project.title.slice(0, 23).trimEnd()}…` : project.title
}

/** The tag of a conversation in projects: the first's, and how many more. */
function tagOf(projects: ReadonlyArray<ProjectLabel>): string | null {
  if (projects.length === 0) {
    return null
  }

  return projects.length === 1
    ? projectTag(projects[0])
    : `${projectTag(projects[0])} +${projects.length - 1}`
}

/**
 * The projects of each conversation the list holds, as a tag for its
 * rows, kept as the Segretario files conversations and the user moves them.
 */
export function useConversationProjectTags(
  messages: ReadonlyArray<{ accountId: string; threadId: string }>,
  enabled: boolean
): ReadonlyMap<string, string> {
  const [tags, setTags] = useState<ReadonlyMap<string, string>>(() => new Map())
  const requested = useRef(new Set<string>())

  const fetchTags = (threads: ReadonlyArray<{ accountId: string; threadId: string }>): void => {
    for (let start = 0; start < threads.length; start += THREADS_PER_REQUEST) {
      const chunk = threads.slice(start, start + THREADS_PER_REQUEST)

      void window.segretarioApi
        .conversationProjects(chunk)
        .then((projects) =>
          setTags((current) => {
            const next = new Map(current)

            chunk.forEach((thread, index) => {
              const tag = tagOf(projects[index] ?? [])

              if (tag) {
                next.set(threadKey(thread), tag)
              } else {
                next.delete(threadKey(thread))
              }
            })

            return next
          })
        )
        .catch(() => undefined)
    }
  }

  useEffect(() => {
    // Off, nothing is asked; the list shows no tags then (see `MessageListViewProps.projectTags`).
    if (!enabled) {
      return
    }

    const missing = new Map<string, { accountId: string; threadId: string }>()

    for (const message of messages) {
      const key = threadKey(message)

      if (!requested.current.has(key)) {
        requested.current.add(key)
        missing.set(key, { accountId: message.accountId, threadId: message.threadId })
      }
    }

    if (missing.size > 0) {
      fetchTags([...missing.values()])
    }
  }, [messages, enabled])

  // A conversation filed or moved, a project renamed: its tags follow.
  useEffect(
    () =>
      window.segretarioApi.onWorkChanged((change) => {
        if (change.projectIds.length === 0) {
          return
        }

        const changed = [...requested.current].map((key) => {
          const [accountId, threadId] = key.split('\u0000')
          return { accountId, threadId }
        })
        const touched =
          change.threadIds.length > 0
            ? changed.filter((thread) => change.threadIds.includes(thread.threadId))
            : changed

        if (touched.length > 0) {
          fetchTags(touched)
        }
      }),
    []
  )

  return tags
}
