import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

/**
 * Buttons with a body (see `.button-*` in globals.css): ink for the ordinary
 * primary action, the seal for the one that sends, the raised key for the
 * secondary. Ghost and outline stay flat until the pointer is on them.
 * Sizes are a desk tool's, not a landing page's: 26, 30 and 34 px.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-[550] transition-[background-color,color,filter,transform] duration-100 disabled:pointer-events-none disabled:opacity-45 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'button-ink',
        seal: 'button-seal',
        secondary: 'button-raised',
        ghost: 'text-muted-foreground hover:bg-hover hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))] hover:bg-hover bg-transparent',
        brand: 'button-seal'
      },
      size: {
        default: 'h-[30px] px-3',
        sm: 'h-[26px] px-2.5 text-[12px] rounded-[6px]',
        lg: 'h-[34px] px-4 text-[13px]',
        icon: 'size-[30px]'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'

    return (
      <Component
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'

export { Button, buttonVariants }
