/**
 * Where a path under `from` is now that it moved to `to` — the rest of it
 * as it was — or null for a path not under it. A folder and its contents,
 * never a sibling that starts the same ("Archivio" is not "Archivio2").
 */
export function movedUnder(from: string, to: string): (path: string) => string | null {
  const trim = (path: string): string => path.replace(/[\\/]+$/, '')
  const base = trim(from)
  const target = trim(to)

  return (path) =>
    path === base
      ? target
      : path.startsWith(`${base}/`) || path.startsWith(`${base}\\`)
        ? `${target}${path.slice(base.length)}`
        : null
}
