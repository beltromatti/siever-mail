import { powerMonitor } from 'electron'

/** Input this recent means someone is at the computer: it is awake, whatever was announced. */
const ACTIVE_IDLE_SECONDS = 60
const CHECK_MS = 30_000

/**
 * Says when the computer goes to sleep and when it is awake again. The
 * system announces both (`suspend`, `resume`), but not the few seconds a
 * sleeping Mac wakes for now and then (Power Nap): the app's timers run
 * there, and the network goes again before an answer comes. Some Macs
 * now and then fail to announce a real wake, so the screen unlocked, or
 * someone using the computer, counts as awake too. Returns the unwatch.
 */
export function watchSystemSleep(onChange: (asleep: boolean) => void): () => void {
  let asleep = false
  const set = (value: boolean): void => {
    if (value !== asleep) {
      asleep = value
      onChange(value)
    }
  }
  const sleeps = (): void => set(true)
  const wakes = (): void => set(false)

  powerMonitor.on('suspend', sleeps)
  powerMonitor.on('resume', wakes)
  powerMonitor.on('unlock-screen', wakes)

  const check = setInterval(() => {
    if (asleep && powerMonitor.getSystemIdleTime() < ACTIVE_IDLE_SECONDS) {
      wakes()
    }
  }, CHECK_MS)

  return () => {
    powerMonitor.removeListener('suspend', sleeps)
    powerMonitor.removeListener('resume', wakes)
    powerMonitor.removeListener('unlock-screen', wakes)
    clearInterval(check)
  }
}
