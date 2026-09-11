import * as React from 'react'

import { cn } from '@renderer/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // h-8 / 12px is the workspace's control size — the toolbar's search box,
          // the reading pane's buttons, a table row. The default used to be h-10
          // and 14px, which is why a form inside a dialog looked like it came
          // from a different application than the list behind it.
          'border-input bg-input/45 text-foreground placeholder:text-muted-foreground/85 focus-visible:ring-ring/70 focus-visible:ring-offset-background flex h-8 w-full rounded-md border px-2.5 py-1 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input }
