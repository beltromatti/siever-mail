import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'

import { cn } from '@renderer/lib/utils'

const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-foreground text-sm font-semibold', className)}
    {...props}
  />
))

Label.displayName = LabelPrimitive.Root.displayName

export { Label }
