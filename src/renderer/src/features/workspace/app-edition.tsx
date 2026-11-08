import extensionShared from '@app/extension/shared'
import { cn, formatAppVersion } from '@renderer/lib/utils'

/**
 * Which SIEVER Mail this is: its version and, under it, the extension that
 * makes it an organisation's edition. The same words wherever the app says
 * so — at the foot of Settings, over the mark of the rail.
 */
export function AppEdition({
  className,
  extensionClassName
}: {
  className?: string
  extensionClassName?: string
}): React.JSX.Element {
  return (
    <span className={cn('block', className)}>
      SIEVER Mail {formatAppVersion(__APP_VERSION__)}
      {extensionShared.identity && (
        <span className={cn('block truncate', extensionClassName)}>
          {extensionShared.identity.name}
        </span>
      )}
    </span>
  )
}
