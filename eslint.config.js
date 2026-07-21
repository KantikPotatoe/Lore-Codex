import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// The three seams, all enforced by no-restricted-imports. Because a later
// config block REPLACES this rule rather than merging with it, every
// carve-out below must re-declare the bans it still wants — writing
// `'no-restricted-imports': 'off'` anywhere would silently drop another
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

// The registry DB (src/registryDb.ts) is a second, smaller Dexie singleton —
// worlds + device-level app settings, not per-world data. It has its own two
// legitimate consumers (src/lores.ts, src/appSettings.ts); the UI has no
// business importing it directly.
const REGISTRY_BAN = {
  group: ['**/registryDb'],
  importNames: ['registry'],
  message:
    'The UI reaches the registry through appSettings.ts or lores.ts, not the registry Dexie singleton directly (see CLAUDE.md "Multiple worlds").',
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
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN, DB_BAN, REGISTRY_BAN] }],
    },
  },
  {
    // The platform seam itself is the one place allowed to import
    // @tauri-apps/*; it still may not touch the Dexie singleton. Its test
    // file is listed here too but this DB_BAN is inert for it: the later
    // `**/*.test.{ts,tsx}` block below matches it too and, since a later
    // block REPLACES the rule rather than merging, that block's blanket
    // 'off' wins. platform.test.ts ends up under the same test exemption as
    // every other test file (needs raw `db` for fixtures) — don't "fix"
    // this by reordering the blocks.
    files: ['src/platform.ts', 'src/platform.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_BAN] }],
    },
  },
  {
    // The registry Dexie singleton's only legitimate consumers: lores.ts and
    // appSettings.ts (both layer world/app-settings CRUD over it), plus the
    // module that defines it. None of the three needs the per-world `db`
    // singleton, so that ban stays; they keep the Tauri ban too.
    files: ['src/lores.ts', 'src/appSettings.ts', 'src/registryDb.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN, DB_BAN] }],
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
      'src/worldMirrorSync.ts',
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
