import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

/**
 * A small tag on a row or a heading: a state ("Da rispondere · ven 30"), a
 * topic, a count. Neutral by default; `urgent` for what is due, `ai` for what
 * the Segretario prepared.
 */
const badgeVariants = cva(
  'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[10.5px] leading-none font-semibold whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-hover text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]',
        muted: 'bg-hover text-muted-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]',
        urgent: 'bg-urgent/[0.08] text-urgent shadow-[inset_0_0_0_1px_hsl(var(--urgent)/0.35)]',
        ai: 'bg-ai-soft text-ai shadow-[inset_0_0_0_1px_hsl(var(--ai)/0.3)]',
        accent: 'bg-hover text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))]'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
