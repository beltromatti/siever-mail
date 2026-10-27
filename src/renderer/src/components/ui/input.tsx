import * as React from 'react'

import { cn } from '@renderer/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // The workspace's control size — the list's search, the reading
          // pane's buttons, a table row — so a form in a dialog belongs to the
          // same application as the list behind it. `.field` presses it into
          // the paper; focused, it lifts onto a sheet.
          'field text-foreground placeholder:text-faint-foreground flex h-[30px] w-full rounded-md px-2.5 py-1 text-[12.5px] transition-[background-color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
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
