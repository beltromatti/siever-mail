import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Path aliases mirror `electron.vite.config.ts` so tests import modules by
 * the same specifiers the app does. `@app/extension/*` resolves to the
 * drop-in when one is checked out and to the public stubs otherwise —
 * exactly the rule the build follows.
 */
const extensionAvailable = existsSync(resolve('extension'))

const alias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@app/extension/types': resolve('src/extension/types.ts'),
  '@app/extension/main': extensionAvailable
    ? resolve('extension/main/index.ts')
    : resolve('src/extension/main.public.ts'),
  '@app/extension/renderer': extensionAvailable
    ? resolve('extension/renderer/index.tsx')
    : resolve('src/extension/renderer.public.tsx'),
  '@app/extension/preload': extensionAvailable
    ? resolve('extension/preload/index.ts')
    : resolve('src/extension/preload.public.ts')
}

/**
 * Main-process code runs on Node and reaches for Node built-ins (`node:fs`,
 * `node:sqlite`, …), so its tests need the node environment — jsdom refuses
 * to bundle those. Renderer code is DOM-bound and keeps jsdom.
 *
 * The `extension/**` globs are no-ops in the public repository: the drop-in
 * directory is gitignored and simply absent there.
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'main',
          environment: 'node',
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'extension/main/**/*.test.ts',
            'extension/shared/**/*.test.ts'
          ]
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: [
            'src/renderer/**/*.test.ts',
            'src/renderer/**/*.test.tsx',
            'extension/renderer/**/*.test.ts',
            'extension/renderer/**/*.test.tsx'
          ]
        }
      }
    ]
  }
})
