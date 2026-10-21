import type * as React from 'react'

import { ShortcutKeys } from '@renderer/components/ui/shortcut-keys'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useCommandKeys } from '@renderer/lib/command-shortcuts'

/**
 * The bubble of a control that runs a command: what it does and the keys
 * that do it from anywhere — the way Outlook teaches its shortcuts. The keys
 * are the user's own, from Settings › Scorciatoie.
 */
export function ActionTooltip({
  label,
  commandId,
  side = 'bottom',
  children
}: {
  label: string
  commandId?: string
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side']
  children: React.ReactElement
}): React.JSX.Element {
  const keys = useCommandKeys(commandId ?? '')

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2">
        <span>{label}</span>
        {commandId && keys && <ShortcutKeys keys={keys} />}
      </TooltipContent>
    </Tooltip>
  )
}
