import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatAppVersion(rawVersion: string): string {
  return rawVersion.replace(/\.0+$/, '')
}

export function formatAddress(address: { name?: string; address: string }): string {
  if (address.name) {
    return `${address.name} <${address.address}>`
  }

  return address.address
}

export function formatDateLabel(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.valueOf())) {
    return value
  }

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) {
    return new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  }).format(date)
}
