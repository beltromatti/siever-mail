import * as React from 'react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'

import { cn } from '@renderer/lib/utils'

const ScrollArea = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    {/*
      Radix wraps the viewport's children in a `display: table` div so the
      content can outgrow the box horizontally. That also makes the wrapper
      shrink-to-fit, which silently defeats `truncate` / `min-w-0` on
      everything inside — long subjects ran under the panel edge with no
      ellipsis instead of being clipped at the row's width. Forcing the
      wrapper back to `block` restores normal width constraints; consumers
      that genuinely need horizontal overflow scroll their own container.
    */}
    <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit] [&>div]:block!">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    // Same geometry and colours as the native scrollbar styled in
    // globals.css — a 10px track with a 6px thumb inset by 2px — so a panel
    // built on this component and a plain overflow container look alike.
    className={cn(
      'flex touch-none p-0.5 select-none',
      orientation === 'vertical' && 'h-full w-2.5',
      orientation === 'horizontal' && 'h-2.5 flex-col',
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="bg-scrollbar-thumb hover:bg-scrollbar-thumb-hover relative flex-1 rounded-full transition-colors" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
