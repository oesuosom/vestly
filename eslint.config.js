import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Allow intentionally-unused bindings prefixed with `_`
      // (e.g. interface-conformance params, discarded destructures).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // ── Scoped exemptions ───────────────────────────────────────────────────────
  // Deliberately listed file-by-file rather than switched off globally, so new
  // code still has to satisfy these rules and each exemption stays visible.

  {
    // Context modules intentionally export their provider component alongside
    // the `useX()` consumer hook — splitting them would scatter one concept
    // across two files for a Fast Refresh nicety that only costs a reload of
    // the provider during development.
    files: ['src/context/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  {
    // The recovery screen is shown when the storage layer itself is broken, so
    // it must not depend on it. Enforced here so the rule can't quietly rot.
    files: ['src/components/layout/RecoveryScreen.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/storage/*', '@/context/*'],
              message: 'RecoveryScreen must work when storage is broken — use the dependency-free helpers in @/utils.',
            },
          ],
        },
      ],
    },
  },

  {
    // TanStack Table's `useReactTable()` returns fresh function identities each
    // render, which this rule reports as un-memoizable. (The React Compiler
    // itself is not enabled in vite.config.ts — eslint-plugin-react-hooks v7
    // ships these rules regardless.) Upstream concern, nothing to fix here.
    files: ['src/pages/Portfolio.tsx'],
    rules: {
      'react-hooks/incompatible-library': 'off',
    },
  },
])
