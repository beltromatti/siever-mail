import type { ReactNode } from 'react'

import { ProviderLogo, type Provider } from '@renderer/components/ui/provider-logo'
import { cn } from '@renderer/lib/utils'

/**
 * A connection by its name — an address, a calendar's name — after its
 * provider's mark, as the lists that go connection by connection say it.
 * The mark's place is kept while the provider is not known yet, so the name
 * does not move when it comes.
 */
export function ConnectionName({
  provider,
  className,
  logoClassName,
  children
}: {
  provider: Provider | null
  className?: string
  /** The mark's size, when the name is set smaller or larger than a row's. */
  logoClassName?: string
  children: ReactNode
}): React.JSX.Element {
  const logo = cn('size-3.5', logoClassName)

  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      {provider ? (
        <ProviderLogo provider={provider} named className={logo} />
      ) : (
        <span aria-hidden className={cn('shrink-0', logo)} />
      )}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  )
}
