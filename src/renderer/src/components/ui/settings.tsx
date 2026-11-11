import type { ComponentType, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'

/**
 * The pieces every page of Impostazioni is made of, the host's and an
 * extension's alike: a page that scrolls, its groups — a title in small
 * capitals, a line on what they are for — and their rows, a switch or a
 * choice on the right of what they set.
 */

/** A page's body, under its title: it scrolls on its own. */
export function SettingsPage({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1', className)}>
      {children}
    </div>
  )
}

/** A group of settings: its title, what it is about, what it does at the side, and its rows. */
export function SettingsGroup({
  title,
  description,
  action,
  children
}: {
  title: ReactNode
  description?: ReactNode
  /** A button that acts on the whole group, beside its title. */
  action?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-group flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{title}</p>
          {description && <p className="text-muted-foreground mt-1 text-[11px]">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

/** What a row sets, on its left. */
function RowText({
  title,
  description
}: {
  title: ReactNode
  description?: ReactNode
}): React.JSX.Element {
  return (
    <span className="min-w-0">
      <span className="block truncate text-[12px] font-medium">{title}</span>
      {description && (
        <span className="text-muted-foreground block text-[11px]">{description}</span>
      )}
    </span>
  )
}

/** A setting that is on or off: the whole row turns it. */
export function SettingRow({
  id,
  title,
  description,
  checked,
  disabled,
  onCheckedChange
}: {
  id: string
  title: ReactNode
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label
      htmlFor={id}
      className="bg-hover flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 has-[button:disabled]:cursor-default"
    >
      <RowText title={title} description={description} />
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </label>
  )
}

/** A setting chosen among a few: what it is on the left, the choice on the right. */
export function ChoiceRow<T extends string>({
  title,
  description,
  value,
  options,
  words,
  label,
  width = 'w-45',
  disabled,
  onChange
}: {
  title: ReactNode
  description?: ReactNode
  value: T
  options: ReadonlyArray<T>
  words: (option: T) => string
  label: string
  width?: string
  disabled?: boolean
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="bg-hover flex items-center justify-between gap-3 rounded-md px-3 py-2">
      <RowText title={title} description={description} />
      <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
        <SelectTrigger className={`${width} shrink-0`} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {words(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** A setting among two or three, all in view: a segmented choice on the right. */
export function OptionsRow<T extends string>({
  title,
  description,
  value,
  options,
  label,
  disabled,
  onChange
}: {
  title: ReactNode
  description?: ReactNode
  value: T
  options: ReadonlyArray<{ value: T; label: string; icon?: ComponentType<{ className?: string }> }>
  label: string
  disabled?: boolean
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="bg-hover flex items-center justify-between gap-3 rounded-md px-3 py-2">
      <RowText title={title} description={description} />
      <div
        role="radiogroup"
        aria-label={label}
        className="bg-background/70 border-border flex shrink-0 gap-0.5 rounded-[7px] border p-0.5"
      >
        {options.map((option) => {
          const Icon = option.icon
          const active = option.value === value

          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'focus-visible:ring-ring/60 flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] font-medium transition-colors outline-none focus-visible:ring-2 disabled:opacity-50',
                active
                  ? 'bg-selected text-foreground'
                  : 'text-muted-foreground hover:bg-hover hover:text-foreground'
              )}
            >
              {Icon && <Icon className="size-3.5" />}
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A row that shows something, with what can be done about it on the right. */
export function ActionRow({
  title,
  description,
  children
}: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="bg-hover flex items-center justify-between gap-3 rounded-md px-3 py-2">
      <RowText title={title} description={description} />
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </div>
  )
}

/** A line under a group: why something went wrong, or what just happened. */
export function SettingsNotice({
  tone = 'info',
  children
}: {
  tone?: 'info' | 'error'
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md px-3 py-2 text-[12px]',
        tone === 'error'
          ? 'text-destructive-soft-foreground border-destructive/35 bg-destructive/10 border'
          : 'bg-hover text-muted-foreground'
      )}
    >
      {children}
    </div>
  )
}

/** Nothing there yet: a quiet dashed line that says so. */
export function SettingsEmpty({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-[12px]">
      {children}
    </div>
  )
}

/** A page still reading what it shows. */
export function SettingsLoading({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="text-muted-foreground mt-4 flex items-center gap-2 text-[12px]">
      <LoaderCircle className="size-4 animate-spin" />
      {children}
    </div>
  )
}
