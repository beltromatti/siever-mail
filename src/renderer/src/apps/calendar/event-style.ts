import type { CSSProperties } from 'react'

/**
 * An event drawn in its calendar's colour — the provider's, data rather
 * than theme — over the page's own: a light wash and a solid edge. A
 * calendar without a colour takes the theme's primary. What is only
 * proposed is drawn fainter, its edge dashed.
 */
export function eventTint(color: string | null, proposed = false): CSSProperties {
  const base = color ?? 'hsl(var(--primary))'

  return {
    backgroundColor: `color-mix(in srgb, ${base} ${proposed ? 7 : 16}%, hsl(var(--background)))`,
    borderLeftColor: base,
    borderLeftStyle: proposed ? 'dashed' : 'solid'
  }
}

/** A calendar's colour as a dot. */
export function dotStyle(color: string | null): CSSProperties {
  return { backgroundColor: color ?? 'hsl(var(--primary))' }
}
