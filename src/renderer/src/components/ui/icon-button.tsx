import * as React from 'react'

import { Button, type ButtonProps } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

export interface IconButtonProps extends Omit<ButtonProps, 'aria-label' | 'title'> {
  /**
   * What the button does, in the user's words. It is the tooltip, the
   * accessible name and the native title all at once, so a control can never
   * ship with one of the three missing.
   */
  label: string
  /** Where the bubble opens. Defaults to below, like the toolbar's. */
  tooltipSide?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
  /** Extra line under the label — a keyboard shortcut, or a caveat. */
  tooltipHint?: string
}

/**
 * A button whose only content is an icon, with the bubble that names it.
 *
 * Icon-only controls were spreading through the app faster than their
 * tooltips: several shipped with a `title` attribute alone, which the OS
 * renders in its own style after its own delay and which never matches the
 * Radix bubble the rest of the app uses. Making the label a required prop
 * means the question "does this one have a tooltip?" cannot come up again —
 * there is no way to render this component without one.
 *
 * The provider lives once at the app root, so every bubble shares a delay
 * and hovering from one control to the next stays instant.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, tooltipSide = 'bottom', tooltipHint, className, children, ...props }, ref) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          size="icon"
          variant="ghost"
          aria-label={label}
          className={cn('shrink-0', className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {tooltipHint && (
          <span className="text-muted-foreground block text-[10.5px] font-normal">
            {tooltipHint}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
)
IconButton.displayName = 'IconButton'
