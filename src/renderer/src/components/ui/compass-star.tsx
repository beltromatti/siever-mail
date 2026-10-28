import { cn } from '@renderer/lib/utils'

/**
 * The Segretario's mark: the compass star of SIEVER Mail's logo — four
 * points, the north–south ones longer, the sides drawn in — wherever the
 * Segretario noted, prepared or is working on something. Drawn in the
 * current colour, sized like a Lucide icon.
 */
export function CompassStar({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn('size-4 shrink-0', className)}
      {...props}
    >
      <path d="M12 .75c.42 5.3 1.95 8.38 3.6 9.6 1.45 1.07 3.85 1.48 6.65 1.65-2.8.17-5.2.58-6.65 1.65-1.65 1.22-3.18 4.3-3.6 9.6-.42-5.3-1.95-8.38-3.6-9.6C6.95 12.58 4.55 12.17 1.75 12c2.8-.17 5.2-.58 6.65-1.65C10.05 9.13 11.58 6.05 12 .75Z" />
    </svg>
  )
}
