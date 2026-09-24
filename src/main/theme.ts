import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, nativeTheme } from 'electron'

import { DEFAULT_THEME_MODE, type ThemeMode } from '@shared/models'

/**
 * Light or dark, for the app and everything native around it.
 *
 * The user's choice becomes Electron's `themeSource`, which is also what the
 * page's `prefers-color-scheme` reports — so the stylesheet needs no other
 * signal, and "Sistema" simply hands the question to the operating system.
 *
 * The window has to open in the right colours, before the database that
 * stores the choice is up; the mode is therefore mirrored into a one-word
 * file in the user data folder, read synchronously at launch.
 */
const THEME_MODE_FILE_NAME = 'theme-mode'

/** The page's `--background` in each palette, painted before it loads. */
const WINDOW_BACKGROUND = { dark: '#0b0f1d', light: '#eff1f5' } as const

function themeModeFilePath(): string {
  return join(app.getPath('userData'), THEME_MODE_FILE_NAME)
}

function isThemeMode(value: string): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function applyStoredThemeMode(): void {
  let stored: string = DEFAULT_THEME_MODE

  try {
    stored = readFileSync(themeModeFilePath(), 'utf8').trim()
  } catch {
    // First launch, or the file was never written: the default applies.
  }

  nativeTheme.themeSource = isThemeMode(stored) ? stored : DEFAULT_THEME_MODE
}

export function applyThemeMode(mode: ThemeMode): void {
  if (nativeTheme.themeSource !== mode) {
    nativeTheme.themeSource = mode
  }

  try {
    writeFileSync(themeModeFilePath(), mode)
  } catch (error) {
    console.warn('[theme] could not remember the theme for the next launch', error)
  }
}

export function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/** Keeps every window's own background in step when the palette flips. */
export function followThemeWithWindowBackgrounds(): void {
  nativeTheme.on('updated', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.setBackgroundColor(windowBackgroundColor())
      }
    }
  })
}
