import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiStore } from './ai-store'
import { ensureAiSchema } from './schema'
import { memorySql } from './testing/memory-sql'

describe('AiStore.recentWork', () => {
  let sql: ReturnType<typeof memorySql>
  let store: AiStore

  beforeEach(async () => {
    sql = memorySql()
    await ensureAiSchema(sql)
    store = new AiStore(sql)
  })

  afterEach(() => {
    vi.useRealTimers()
    sql.close()
  })

  it('finds what is searched for deep in the diary, page after page, none twice or left out', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-06T09:00:00Z'), toFake: ['Date'] })

    // Many runs within the same millisecond: the pages must not lose or repeat one between them.
    for (let index = 0; index < 700; index += 1) {
      await store.createActivity({
        id: `run-${String(index).padStart(4, '0')}`,
        task: 'lettura',
        title: index % 250 === 0 ? 'Letta la mail di Perché Srl' : `Letta la mail ${index}`,
        status: 'done',
        visibility: 'diario'
      })
    }

    const found = await store.recentWork(0, 10, (entry) =>
      entry.title.toLowerCase().includes('perché')
    )

    expect(found.map((entry) => entry.activityId)).toEqual(['run-0500', 'run-0250', 'run-0000'])
    expect(await store.recentWork(0, 5)).toHaveLength(5)
  })
})
