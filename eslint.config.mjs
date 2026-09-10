import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'electron-starter-003/**',
      // One-off bug reproductions. `repro-squire.js` in particular is a
      // vendored minified copy of Squire — the same library the app already
      // depends on — kept only to replay a signature bug that has since been
      // fixed. Linting third-party minified output produced 403 of the
      // project's 421 lint errors and told us nothing.
      'scripts/repro-*',
      '**/.e2e-out/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      'react-refresh/only-export-components': 'off'
    }
  },
  {
    // Plain-JS tooling: audit helpers and Playwright e2e drivers. They are
    // scripts, not application modules, so the TypeScript-oriented rules the
    // app holds itself to do not apply.
    files: ['scripts/**/*.mjs', 'extension/scripts/**/*.mjs', '*.mjs'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-expressions': 'off'
    }
  },
  eslintConfigPrettier
)
