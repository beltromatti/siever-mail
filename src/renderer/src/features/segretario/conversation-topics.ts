import { useEffect, useMemo, useRef, useState } from 'react'

import type { Topic } from '@shared/segretario'

/** Threads are asked for in batches this big. */
const THREADS_PER_REQUEST = 500

export function threadKey(message: { accountId: string; threadId: string }): string {
  return `${message.accountId}\u0000${message.threadId}`
}

/** A topic as a row's tag: a pratica by its number ("Prat2451"), another by its title, short. */
export function topicTag(topic: Topic): string {
  if (topic.origin === 'extension') {
    return topic.title.split(' · ')[0]
  }

  return topic.title.length > 24 ? `${topic.title.slice(0, 23).trimEnd()}…` : topic.title
}

/**
 * The topic of each conversation the list holds — its pratica — as a tag
 * to show in its rows, kept as the Segretario files conversations.
 */
export function useConversationTopicTags(
  messages: ReadonlyArray<{ accountId: string; threadId: string }>,
  topics: ReadonlyArray<Topic>
): ReadonlyMap<string, string> {
  const [topicOf, setTopicOf] = useState<ReadonlyMap<string, string | null>>(() => new Map())
  const requested = useRef(new Set<string>())

  const fetchTopics = (threads: ReadonlyArray<{ accountId: string; threadId: string }>): void => {
    for (let start = 0; start < threads.length; start += THREADS_PER_REQUEST) {
      const chunk = threads.slice(start, start + THREADS_PER_REQUEST)

      void window.segretarioApi
        .conversationTopics(chunk)
        .then((ids) =>
          setTopicOf((current) => {
            const next = new Map(current)
            chunk.forEach((thread, index) => next.set(threadKey(thread), ids[index]))
            return next
          })
        )
        .catch(() => undefined)
    }
  }

  useEffect(() => {
    const missing = new Map<string, { accountId: string; threadId: string }>()

    for (const message of messages) {
      const key = threadKey(message)

      if (!requested.current.has(key)) {
        requested.current.add(key)
        missing.set(key, { accountId: message.accountId, threadId: message.threadId })
      }
    }

    if (missing.size > 0) {
      fetchTopics([...missing.values()])
    }
  }, [messages])

  // A conversation filed, or moved by the user: its tag follows.
  useEffect(
    () =>
      window.segretarioApi.onNotesChanged((change) => {
        const changed = change.threadIds
          .map((threadId) => ({ accountId: change.accountId, threadId }))
          .filter((thread) => requested.current.has(threadKey(thread)))

        if (changed.length > 0) {
          fetchTopics(changed)
        }
      }),
    []
  )

  return useMemo(() => {
    const byId = new Map(topics.map((topic) => [topic.id, topic]))
    const tags = new Map<string, string>()

    for (const [key, id] of topicOf) {
      const topic = id ? byId.get(id) : undefined

      if (topic) {
        tags.set(key, topicTag(topic))
      }
    }

    return tags
  }, [topicOf, topics])
}
