import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { app, dialog, shell } from 'electron'

import { DEFAULT_LANGUAGE, defineMessages, messagesIn, type Language } from '@shared/i18n'
import type { UninstallKeep, UninstallOffer } from '@shared/models'

import { APP_ID, PRODUCT_NAME } from './app-identity'
import { messages, profileLanguage } from './i18n'
import {
  KEPT_CONNECTIONS_FILE,
  readConnections,
  writeKeptConnections
} from './services/kept-connections'

/**
 * Taking SIEVER Mail off the computer (vision §13.2): the user decides what
 * stays — the connections, so that the next install finds them connected,
 * or nothing at all — and it is so on every system.
 *
 * One process does the clearing: the app's own executable, started for
 * that alone (`--siever-uninstall`) with a Chromium profile of its own, so
 * the profile it clears is held by nobody. Whoever asks, it is the same
 * code: the uninstaller on Windows — from Settings › Apps or from the app —,
 * the app itself on macOS and Linux, where a program is taken away by
 * dragging it to the Trash and nothing would ask.
 */

const PROFILE_DATABASE = 'siever-mail.sqlite'
/** Where Windows and Linux keep the key the accesses are encrypted with; macOS keeps it in the keychain. */
const SAFE_STORAGE_KEY_FILE = 'Local State'
/** How long the app that asked is waited for: it finishes what it was writing first. */
const APP_EXIT_WAIT_MS = 60_000

const MESSAGES = defineMessages({
  notAProfile: {
    en: (profile: string) => `${profile} isn’t a SIEVER Mail profile: it wasn’t touched.`,
    it: (profile: string) => `${profile} non è un profilo di SIEVER Mail: non è stato toccato.`,
    de: (profile: string) => `${profile} ist kein Profil von SIEVER Mail: Es wurde nicht verändert.`
  },
  notFullyRemoved: {
    en: 'SIEVER Mail wasn’t completely removed.',
    it: 'SIEVER Mail non è stato tolto del tutto.',
    de: 'SIEVER Mail wurde nicht vollständig entfernt.'
  },
  removed: {
    en: 'SIEVER Mail has been removed from this computer.',
    it: 'SIEVER Mail è stato tolto da questo computer.',
    de: 'SIEVER Mail wurde von diesem Computer entfernt.'
  },
  couldNotRemove: {
    en: (paths: string) => `This couldn’t be removed:\n${paths}\n\nYou can remove it by hand.`,
    it: (paths: string) => `Non si è potuto togliere:\n${paths}\n\nSi può togliere a mano.`,
    de: (paths: string) =>
      `Folgendes konnte nicht entfernt werden:\n${paths}\n\nSie können es von Hand entfernen.`
  },
  onlyConnections: {
    en: 'Only the connections remain: install it again and you’ll find them already connected.',
    it: 'Restano solo le connessioni: installandolo di nuovo, le ritrovi già collegate.',
    de: 'Nur die Verbindungen bleiben: Wenn Sie es erneut installieren, sind sie bereits verbunden.'
  },
  nothingLeft: { en: 'Nothing is left.', it: 'Non resta niente.', de: 'Es bleibt nichts zurück.' },
  nothingOfData: {
    en: 'Nothing of its data is left. The program itself is removed with the package manager.',
    it: 'Non resta niente dei suoi dati. Il programma si toglie con il gestore dei pacchetti.',
    de: 'Von seinen Daten bleibt nichts zurück. Das Programm selbst entfernen Sie mit der Paketverwaltung.'
  },
  ok: { en: 'OK', it: 'OK', de: 'OK' },
  onlyInstalled: {
    en: 'SIEVER Mail can be removed from here only in the installed app.',
    it: 'Da qui SIEVER Mail si toglie solo nell’app installata.',
    de: 'Von hier aus lässt sich SIEVER Mail nur in der installierten App entfernen.'
  }
})

interface UninstallRequest {
  keep: UninstallKeep
  /** The profile to clear, as the app that asked knew it. */
  profile: string
  /** The app that asked, still closing. */
  waitFor: number | null
  /** The program to take away once the data is: the macOS bundle, the AppImage. */
  program: string | null
  /** Asked from the app: nobody else says how it went — the Windows uninstaller runs unseen then. */
  tell: boolean
}

/** The clearing asked on the command line, if this process was started for it. */
export function uninstallRequest(): UninstallRequest | null {
  const keep = app.commandLine.getSwitchValue('siever-uninstall')
  const profile = app.commandLine.getSwitchValue('siever-profile')

  if ((keep !== 'connessioni' && keep !== 'niente') || !profile) {
    return null
  }

  const waitFor = Number(app.commandLine.getSwitchValue('siever-wait'))
  return {
    keep,
    profile: resolve(profile),
    waitFor: Number.isInteger(waitFor) && waitFor > 0 ? waitFor : null,
    program: app.commandLine.getSwitchValue('siever-program') || null,
    tell: app.commandLine.hasSwitch('siever-tell') || Boolean(waitFor)
  }
}

/**
 * Clears as asked, takes the program away if asked, and exits: 0 when all
 * went, 1 when something stayed — the uninstaller says it, the app's own
 * flow shows it.
 */
export async function runUninstall(request: UninstallRequest): Promise<void> {
  await app.whenReady()

  // No window and no place in the Dock: it only clears, and says how it went.
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
  }
  const left: string[] = []
  // The words of the profile taken away, read before it goes: this process has a profile of its own.
  const language = profileLanguage(request.profile)

  try {
    if (request.waitFor) {
      await processGone(request.waitFor)
    }

    left.push(...(await clearProfile(request.profile, request.keep, process.platform, language)))
    forgetLoginItem()

    if (request.keep === 'niente') {
      await forgetSystemTraces(request.profile)
    }

    if (request.program) {
      left.push(...(await removeProgram(request.program)))
    }
  } catch (error) {
    left.push(error instanceof Error ? error.message : String(error))
  }

  if (request.tell) {
    await sayHowItWent(request, left, language)
  }

  app.exit(left.length > 0 ? 1 : 0)
}

/** Resolves once the process is gone, or after the wait: it was told to quit. */
async function processGone(pid: number): Promise<void> {
  const until = Date.now() + APP_EXIT_WAIT_MS

  while (Date.now() < until) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }

    await new Promise((done) => setTimeout(done, 200))
  }
}

/**
 * Empties the profile, keeping the connections when asked: they are read
 * from the database first, and stay alone, with the key that opens their
 * accesses. A folder that holds no SIEVER Mail database is not ours to
 * empty — a path given wrong never clears anything else, and says so in
 * `language`.
 */
export async function clearProfile(
  profile: string,
  keep: UninstallKeep,
  platform: NodeJS.Platform = process.platform,
  language: Language = DEFAULT_LANGUAGE
): Promise<string[]> {
  if (!existsSync(profile)) {
    return []
  }

  if (
    !existsSync(join(profile, PROFILE_DATABASE)) &&
    !existsSync(join(profile, KEPT_CONNECTIONS_FILE))
  ) {
    return [messagesIn(MESSAGES, language).notAProfile(profile)]
  }

  // The connections in the database; or, the database gone, those a former uninstall kept here.
  const kept = keep === 'connessioni' ? readConnections(profile) : null
  const keptBefore =
    keep === 'connessioni' && !kept && existsSync(join(profile, KEPT_CONNECTIONS_FILE))
  const staying = new Set(
    kept || keptBefore
      ? [
          ...(keptBefore ? [KEPT_CONNECTIONS_FILE] : []),
          ...(platform === 'darwin' ? [] : [SAFE_STORAGE_KEY_FILE])
        ]
      : []
  )
  const left: string[] = []

  for (const entry of await readdir(profile)) {
    if (staying.has(entry)) {
      continue
    }

    try {
      await rm(join(profile, entry), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 300
      })
    } catch {
      left.push(join(profile, entry))
    }
  }

  if (kept) {
    writeKeptConnections(profile, kept)
  } else if (staying.size === 0 && left.length === 0) {
    await rm(profile, { recursive: true, force: true }).catch(() => left.push(profile))
  }

  return left
}

/** The app opened at login no more: the entry would point at nothing. */
function forgetLoginItem(): void {
  if (process.platform === 'linux') {
    return
  }

  // The entry Windows keeps is named after the app's identity, as the app set it.
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID)
  }

  try {
    if (app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: false })
    }
  } catch {
    // Never set, or not ours to change: nothing to take away.
  }
}

/**
 * What the system keeps of SIEVER Mail outside its profile, when nothing is
 * to stay: on macOS the key of the accesses in the keychain, the window's
 * state, the preferences and the logs; on Linux the key in the keyring.
 * The key is shared by every profile of the app on this computer (the
 * development's and the test studio's go by the same name): it stays while
 * one of them is here.
 */
async function forgetSystemTraces(profile: string): Promise<void> {
  if (!app.isPackaged) {
    return
  }

  const name = app.getName()
  const others = (await readdir(dirname(profile)).catch(() => [] as string[])).filter(
    (entry) => entry !== basename(profile) && entry.startsWith(`${name}-`)
  )

  if (process.platform === 'darwin') {
    const library = join(homedir(), 'Library')

    if (others.length === 0) {
      await run('security', ['delete-generic-password', '-s', `${name} Safe Storage`, '-a', name])
    }

    await run('defaults', ['delete', APP_ID])
    await Promise.all(
      [
        join(library, 'Preferences', `${APP_ID}.plist`),
        join(library, 'Saved Application State', `${APP_ID}.savedState`),
        join(library, 'HTTPStorages', APP_ID),
        join(library, 'Caches', APP_ID),
        join(library, 'Caches', name),
        join(library, 'Logs', name)
      ].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined))
    )
  }

  if (process.platform === 'linux' && others.length === 0) {
    await run('secret-tool', [
      'clear',
      'xdg:schema',
      'chrome_libsecret_os_crypt_password_v2',
      'application',
      name
    ])
  }
}

/**
 * The program itself: the macOS bundle to the Trash, as the user would
 * drag it; the AppImage deleted. Said when the system does not let it go.
 */
async function removeProgram(program: string): Promise<string[]> {
  try {
    if (process.platform === 'darwin') {
      await shell.trashItem(program)
    } else {
      await rm(program, { force: true })
    }

    return []
  } catch {
    return [program]
  }
}

async function sayHowItWent(
  request: UninstallRequest,
  left: string[],
  language: Language
): Promise<void> {
  const m = messagesIn(MESSAGES, language)
  app.focus({ steal: true })
  await dialog.showMessageBox({
    type: left.length > 0 ? 'warning' : 'info',
    title: 'SIEVER Mail',
    message: left.length > 0 ? m.notFullyRemoved : m.removed,
    detail:
      left.length > 0
        ? m.couldNotRemove(left.join('\n'))
        : request.keep === 'connessioni'
          ? m.onlyConnections
          : request.program || process.platform === 'win32'
            ? m.nothingLeft
            : m.nothingOfData,
    buttons: [m.ok]
  })
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((done) => {
    execFile(command, args, { timeout: 15_000, windowsHide: true }, () => done())
  })
}

/* ────────────────────────────── asked from the app ────────────────────────────── */

/** The program this app runs from, to take away after its data: the bundle, the AppImage. */
function ownProgram(): string | null {
  if (process.platform === 'darwin') {
    const bundle = resolve(process.execPath, '..', '..', '..')
    return bundle.endsWith('.app') ? bundle : null
  }

  return process.platform === 'linux' ? (process.env['APPIMAGE'] ?? null) : null
}

/** The uninstaller the Windows installer leaves beside the app, named after the product. */
function windowsUninstaller(): string {
  return join(dirname(process.execPath), `Uninstall ${PRODUCT_NAME}.exe`)
}

/** What taking the app away from Settings › Dati can do here. */
export function uninstallOffer(): UninstallOffer {
  const system =
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'

  if (!app.isPackaged || (system === 'windows' && !existsSync(windowsUninstaller()))) {
    return { available: false, removesProgram: false, system }
  }

  return { available: true, removesProgram: system === 'windows' || ownProgram() !== null, system }
}

/**
 * Takes SIEVER Mail away, as the user chose in Settings › Dati: on Windows
 * its uninstaller, told the choice; elsewhere the clearing process, which
 * waits for this app to have quit. The caller quits the app right after.
 */
export function beginUninstall(keep: UninstallKeep): void {
  if (!uninstallOffer().available) {
    throw new Error(messages(MESSAGES).onlyInstalled)
  }

  if (process.platform === 'win32') {
    // Through the shell, which asks for the administrator's consent where the install needs it.
    const quoted = (value: string): string => `'${value.replace(/'/g, "''")}'`
    spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath ${quoted(windowsUninstaller())} -ArgumentList '/S','--siever-keep=${keep}'`
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    ).unref()
    return
  }

  const program = ownProgram()
  // An AppImage runs from a mount that goes with the process: the clearing starts from the file.
  const executable = process.platform === 'linux' && program ? program : process.execPath
  const ownProfile = join(app.getPath('temp'), `siever-mail-disinstalla-${process.pid}`)
  // Through the shell, which waits for it and then takes away the profile it ran with.
  spawn(
    '/bin/sh',
    [
      '-c',
      '"$0" "$@"; rm -rf "$SIEVER_OWN_PROFILE"',
      executable,
      `--siever-uninstall=${keep}`,
      `--siever-profile=${app.getPath('userData')}`,
      `--siever-wait=${process.pid}`,
      ...(program ? [`--siever-program=${program}`] : []),
      `--user-data-dir=${ownProfile}`
    ],
    { detached: true, stdio: 'ignore', env: { ...process.env, SIEVER_OWN_PROFILE: ownProfile } }
  ).unref()
}
