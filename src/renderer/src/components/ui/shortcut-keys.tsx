import { cn } from '@renderer/lib/utils'

/** Key caps for a shortcut, drawn the same in a tooltip, a menu and Settings. */
export function ShortcutKeys({
  keys,
  className
}: {
  keys: readonly string[]
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="border-border/80 bg-background/55 text-foreground/90 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border px-1 font-sans text-[10px] leading-none font-medium"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
