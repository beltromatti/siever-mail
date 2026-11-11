import { useEffect, useState } from 'react'

const ASSISTANT_MIN_WIDTH = 340
const ASSISTANT_MAX_WIDTH = 440
const ASSISTANT_SHARE_OF_WIDTH = 0.27

/**
 * The Segretario's column: room for its sentences and its cards, never so
 * wide it takes the message's place. The workspace spans the window, so its
 * share is of the window's width — which lets what is fixed on the window,
 * the notices, keep clear of it.
 */
export const ASSISTANT_WIDTH = `clamp(${ASSISTANT_MIN_WIDTH}px, ${ASSISTANT_SHARE_OF_WIDTH * 100}vw, ${ASSISTANT_MAX_WIDTH}px)`

/** How much of the window's right edge the Segretario's column takes, in px: 0 while it is closed. */
export function useAssistantInset(open: boolean): number {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return open
    ? Math.min(
        ASSISTANT_MAX_WIDTH,
        Math.max(ASSISTANT_MIN_WIDTH, windowWidth * ASSISTANT_SHARE_OF_WIDTH)
      )
    : 0
}
