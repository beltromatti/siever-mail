import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'

import { cn } from '@renderer/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root

/**
 * Whether the last thing the user touched was the keyboard. Tracked in the
 * capture phase, before any handler gets to move focus.
 */
let keyboardModality = false
window.addEventListener('keydown', () => (keyboardModality = true), true)
window.addEventListener('pointerdown', () => (keyboardModality = false), true)

/**
 * Opens on hover, and on focus only when the keyboard put it there. A menu
 * or dialog hands focus back to its trigger when it closes; after a mouse
 * interaction a tooltip opened by that focus would sit over the list until
 * something else took focus. `:focus-visible` cannot tell the two apart:
 * Chromium lets the programmatic focus of a Radix menu count as visible.
 */
const TooltipTrigger = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onFocus, ...props }, ref) => (
  <TooltipPrimitive.Trigger
    ref={ref}
    onFocus={(event) => {
      onFocus?.(event)

      // Radix skips its own open handler for a default-prevented event.
      if (!keyboardModality) {
        event.preventDefault()
      }
    }}
    {...props}
  />
))
TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName

const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'border-border bg-popover text-popover-foreground z-50 overflow-hidden rounded-md border px-3 py-1.5 text-xs font-medium shadow-md',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
