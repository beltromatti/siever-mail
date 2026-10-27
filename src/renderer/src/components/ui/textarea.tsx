import * as React from 'react'

import { cn } from '@renderer/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'field text-foreground placeholder:text-faint-foreground flex min-h-20 w-full rounded-md px-2.5 py-1.5 text-[12.5px] transition-[background-color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    )
  }
)

Textarea.displayName = 'Textarea'

export { Textarea }
