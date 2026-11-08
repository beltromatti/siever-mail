import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const appVersion = process.env.SIEVER_APP_VERSION?.trim() || packageJson.version
const extensionEnabled = process.env.LOAD_EXTENSION === '1'

// Asked for an extension, a build without one would be the public app under its name.
if (extensionEnabled && !existsSync(resolve('extension'))) {
  throw new Error(
    'LOAD_EXTENSION=1, but there is no extension/ to load: check the extension out there first.'
  )
}

function extensionMainAliasTarget(): string {
  return extensionEnabled
    ? resolve('extension/main/index.ts')
    : resolve('src/extension/main.public.ts')
}

function extensionRendererAliasTarget(): string {
  return extensionEnabled
    ? resolve('extension/renderer/index.tsx')
    : resolve('src/extension/renderer.public.tsx')
}

function extensionSharedAliasTarget(): string {
  return extensionEnabled
    ? resolve('extension/shared/index.ts')
    : resolve('src/extension/shared.public.ts')
}

function extensionPreloadAliasTarget(): string {
  return extensionEnabled
    ? resolve('extension/preload/index.ts')
    : resolve('src/extension/preload.public.ts')
}

const sharedAliases = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@app/extension/types': resolve('src/extension/types.ts'),
  '@app/extension/shared': extensionSharedAliasTarget()
}

const mainAliases = {
  ...sharedAliases,
  '@app/extension/kit/main': resolve('src/extension/kit/main.ts'),
  '@app/extension/main': extensionMainAliasTarget()
}

const rendererAliases = {
  ...sharedAliases,
  '@app/extension/kit/renderer': resolve('src/extension/kit/renderer.ts'),
  '@app/extension/renderer': extensionRendererAliasTarget()
}

const preloadAliases = {
  ...sharedAliases,
  '@app/extension/preload': extensionPreloadAliasTarget()
}

const define = {
  __APP_VERSION__: JSON.stringify(appVersion)
}

export default defineConfig({
  main: {
    resolve: { alias: mainAliases },
    define
  },
  preload: {
    resolve: { alias: preloadAliases },
    define,
    build: {
      // Two sandboxed preloads: a sandbox cannot load a chunk they would
      // share, so each is built whole.
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'pdf-pages': resolve('src/preload/pdf-pages.ts')
        }
      }
    }
  },
  renderer: {
    resolve: { alias: rendererAliases },
    define,
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // The hidden page that draws a scanned PDF's pages (see src/shared/pdf-pages.ts).
          'pdf-pages': resolve('src/renderer/pdf-pages.html')
        }
      }
    }
  }
})
