import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const appVersion = process.env.SIEVER_APP_VERSION?.trim() || packageJson.version
const extensionRequested = process.env.LOAD_EXTENSION === '1'
const extensionDirectoryAvailable = existsSync(resolve('private-siever'))
const extensionEnabled = extensionRequested && extensionDirectoryAvailable

if (extensionRequested && !extensionDirectoryAvailable) {
  console.warn(
    '[electron.vite.config] LOAD_EXTENSION=1 was set but private-siever/ is missing — falling back to public build.'
  )
}

const buildVariant: 'public' | 'siever' = extensionEnabled ? 'siever' : 'public'

function extensionMainAliasTarget(): string {
  return extensionEnabled
    ? resolve('private-siever/main/index.ts')
    : resolve('src/extension/main.public.ts')
}

function extensionRendererAliasTarget(): string {
  return extensionEnabled
    ? resolve('private-siever/renderer/index.tsx')
    : resolve('src/extension/renderer.public.tsx')
}

function extensionPreloadAliasTarget(): string {
  return extensionEnabled
    ? resolve('private-siever/preload/index.ts')
    : resolve('src/extension/preload.public.ts')
}

const sharedAliases = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@app/extension/types': resolve('src/extension/types.ts')
}

const mainAliases = {
  ...sharedAliases,
  '@app/extension/main': extensionMainAliasTarget()
}

const rendererAliases = {
  ...sharedAliases,
  '@app/extension/renderer': extensionRendererAliasTarget()
}

const preloadAliases = {
  ...sharedAliases,
  '@app/extension/preload': extensionPreloadAliasTarget()
}

const define = {
  __APP_VERSION__: JSON.stringify(appVersion),
  __APP_BUILD_VARIANT__: JSON.stringify(buildVariant)
}

export default defineConfig({
  main: {
    resolve: { alias: mainAliases },
    define
  },
  preload: {
    resolve: { alias: preloadAliases },
    define
  },
  renderer: {
    resolve: { alias: rendererAliases },
    define,
    plugins: [react()]
  }
})
