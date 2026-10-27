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
    <span className={cn('inline-flex items-center gap-[3px]', className)}>
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="keycap inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[4px] px-1 font-sans text-[10px] leading-none font-semibold"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
