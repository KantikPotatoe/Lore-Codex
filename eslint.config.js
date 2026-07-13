import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// The two seams, both enforced by no-restricted-imports. Because a later
// config block REPLACES this rule rather than merging with it, every
// carve-out below must re-declare the bans it still wants — writing
// `'no-restricted-imports': 'off'` anywhere would silently drop the other
// seam's ban in those files.
const TAURI_BAN = {
  group: ['@tauri-apps/*'],
  message:
    'Shell APIs go through the platform seam — add what you need to src/platform.ts instead (see CLAUDE.md "Desktop shell").',
}

const DB_BAN = {
  group: ['**/db', '**/db/schema'],
  importNames: ['db'],
  message:
    'The UI reaches the data layer through a repository, not the Dexie singleton — add what you need to src/db/repositories.ts (see CLAUDE.md "Data layer").',
}

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
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN, DB_BAN] }],
    },
  },
  {
    // The platform seam itself (and its tests, which mock the plugin modules)
    // is the one place allowed to import @tauri-apps/*. It still may not touch
    // the Dexie singleton.
    files: ['src/platform.ts', 'src/platform.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_BAN] }],
    },
  },
  {
    // The data layer owns `db`; the infra modules below do whole-DB,
    // cross-table work (exportAll, the search-index sync, snapshot capture,
    // the two exporters) that a per-table repository would serve worse, not
    // better. This exemption is deliberate and permanent — see the header of
    // src/db/repositories.ts. They keep the Tauri ban.
    files: [
      'src/db/**/*.ts',
      'src/backup.ts',
      'src/searchSync.ts',
      'src/snapshots.ts',
      'src/htmlExport.ts',
      'src/manuscriptExport.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN] }],
    },
  },
  {
    // Tests set up fixtures against the tables directly.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
