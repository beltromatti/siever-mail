import { describe, expect, it, vi } from 'vitest'

import { Reachability } from './reachability'

describe('Reachability', () => {
  it('waits longer at every failed try, once for the calls that fail together', () => {
    const changes = vi.fn()
    const reachability = new Reachability(changes)
    const before = Date.now() - 1

    reachability.failed(Date.now())
    const first = reachability.waiting!.until - Date.now()
    // A call made before the wait began fails with it: not a second try.
    reachability.failed(before)
    expect(reachability.waiting!.until - Date.now()).toBeLessThanOrEqual(first)
    expect(first).toBeLessThanOrEqual(30_000)

    reachability.failed(Date.now())
    expect(reachability.waiting!.until - Date.now()).toBeGreaterThan(30_000)
    expect(reachability.open).toBe(false)
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('wakes whoever waits when the computer is back online, and ends the wait when a call gets through', async () => {
    const reachability = new Reachability()
    reachability.failed(Date.now())

    const waited = reachability.wait(new AbortController().signal)
    reachability.online()
    await waited

    expect(reachability.open).toBe(true)
    expect(reachability.waiting).not.toBeNull()
    reachability.answered()
    expect(reachability.waiting).toBeNull()
  })

  it('stops waiting when the run is stopped', async () => {
    const reachability = new Reachability()
    reachability.failed(Date.now())
    const controller = new AbortController()

    const waited = reachability.wait(controller.signal)
    controller.abort()

    await expect(waited).rejects.toThrow()
  })
})
