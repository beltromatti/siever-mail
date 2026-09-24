import { clampReaderZoom, READER_ZOOM_DEFAULT } from '@shared/models'

/** The steps a browser zooms through, so a notch feels the same here. */
const READER_ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const

/** The next step above (`1`) or below (`-1`) the current zoom. */
export function steppedReaderZoom(current: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? READER_ZOOM_STEPS.find((step) => step > current)
      : [...READER_ZOOM_STEPS].reverse().find((step) => step < current)

  return next ?? current
}

/**
 * Where a Ctrl/⌘ + wheel event takes the zoom. A mouse wheel moves in
 * notches and steps like the keyboard does; a trackpad pinch arrives as a
 * stream of small deltas and scales smoothly with the fingers.
 */
export function wheelReaderZoom(current: number, deltaY: number): number {
  if (Math.abs(deltaY) >= 50) {
    return steppedReaderZoom(current, deltaY < 0 ? 1 : -1)
  }

  return clampReaderZoom(current * Math.exp(-deltaY / 100))
}

export const READER_ZOOM_RESET = READER_ZOOM_DEFAULT
