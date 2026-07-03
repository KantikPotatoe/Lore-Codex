import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The platform-seam rule (CLAUDE.md "Desktop shell"): only
      // src/platform.ts may talk to the Tauri APIs, so the web build and the
      // shell can't drift apart via a stray direct import.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message:
                'Shell APIs go through the platform seam — add what you need to src/platform.ts instead (see CLAUDE.md "Desktop shell").',
            },
          ],
        },
      ],
    },
  },
  {
    // The seam itself (and its tests, which mock the plugin modules) is the
    // one place allowed to import @tauri-apps/*.
    files: ['src/platform.ts', 'src/platform.test.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
