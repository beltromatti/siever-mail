import { LoaderCircle } from 'lucide-react'

import { cn } from '@renderer/lib/utils'

interface SpinnerProps {
  className?: string
}

export function Spinner({ className }: SpinnerProps): React.JSX.Element {
  return <LoaderCircle className={cn('text-muted-foreground size-4 animate-spin', className)} />
}
