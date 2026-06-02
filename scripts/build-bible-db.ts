/**
 * CLI entry for build-bible-db. Run via vite-node so the `@/` alias resolves:
 *   npm run build-bible-db
 *
 * Reads the 13 public-domain canonical JSONs from `bibles-canonical/` and emits
 * the prebuilt asset to `public/assets/databases/soapjournal.db`. See the
 * README "Building the prebuilt Bible asset" note for the full operational flow.
 */

import { runBuildCli } from '../src/lib/db/buildBibleDb'

const code = await runBuildCli({
  inputDir: 'bibles-canonical',
  outputDbPath: 'public/assets/databases/soapjournal.db',
})

process.exit(code)
