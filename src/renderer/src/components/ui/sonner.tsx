import type { CSSProperties } from 'react'
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner'

/**
 * App-wide toast host, themed from the same tokens as every other surface.
 *
 * Sonner draws its toasts from a handful of CSS variables; pointing them at
 * our tokens is what makes a toast look like the dialogs and menus around
 * it in both themes, instead of carrying the library's own palette. Its
 * `system` theme reads the same colour scheme the app's theme sets, so what
 * the library still styles itself follows along.
 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  return (
    <SonnerToaster
      theme="system"
      richColors
      position="bottom-right"
      offset={16}
      gap={8}
      visibleToasts={4}
      style={
        {
          '--normal-bg': 'hsl(var(--popover))',
          '--normal-text': 'hsl(var(--popover-foreground))',
          '--normal-border': 'hsl(var(--border))',
          '--success-bg': 'hsl(var(--popover))',
          '--success-text': 'hsl(var(--popover-foreground))',
          '--success-border': 'hsl(var(--border))',
          '--error-bg': 'hsl(var(--popover))',
          '--error-text': 'hsl(var(--destructive))',
          '--error-border': 'hsl(var(--destructive) / 0.45)',
          '--border-radius': 'calc(var(--radius) - 2px)',
          // The spinner of a pending toast.
          '--gray11': 'hsl(var(--muted-foreground))',
          fontFamily: 'var(--font-sans)'
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'shadow-xl text-[12px]! gap-2.5!',
          title: 'font-medium',
          description: 'text-muted-foreground! text-[11px]!',
          actionButton:
            'bg-secondary! text-secondary-foreground! hover:bg-secondary/80! h-6! rounded-md! px-2! text-[11px]! font-medium!',
          icon: 'text-primary in-data-[type=error]:text-destructive'
        }
      }}
      {...props}
    />
  )
}
