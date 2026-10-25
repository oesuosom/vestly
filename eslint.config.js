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
    // (a) Enter/exit animation orchestration. These components drive CSS
    // transitions by flipping state across a requestAnimationFrame (mount →
    // paint → `open`). The cascading render the rule warns about IS the
    // mechanism — it's what gives the browser a frame to paint the "from"
    // state before the transition starts. HoldingSlidePanel additionally holds
    // the scroll lock through the close animation on a timeout, for the reason
    // documented at its `locked` state.
    //
    // All four run the same enter effect; folding it into a shared
    // `useEnterExit(isOpen)` hook would retire this whole block — tracked
    // follow-up, not yet done.
    files: [
      'src/components/ui/Modal.tsx',
      'src/components/ui/Toast.tsx',
      'src/features/accounts/HoldingSlidePanel.tsx',
      'src/features/settings/SettingsDialog.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },

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
