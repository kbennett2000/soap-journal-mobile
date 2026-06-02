/**
 * build-bible-db: emit the prebuilt SQLite asset the app ships.
 *
 * A pure-Node build tool (better-sqlite3). It runs migration v1 on a fresh DB,
 * then for each canonical JSON in the input dir: read -> validate (cycle-3
 * `validateCanonicalTranslation`) -> insert (cycle-5a `loadTranslation`), and
 * emits the populated DB to the Capacitor prebuilt-asset location. See
 * docs/first-run-and-import.md "Build-time recap".
 *
 * Dev/build only — like the better-sqlite3 adapter it is never imported from
 * the app's runtime graph, so it is not bundled into the WebView. Consuming the
 * asset (copyFromAssets / first launch) is a later cycle; this only produces it.
 *
 * Asset convention (read from @capacitor-community/sqlite v8.1.0 Android
 * source, UtilsFile.copyFromAssetsToDatabase): files live in
 * `public/assets/databases`; a plain `<name>.db` is copied and renamed
 * `<name>SQLite.db`, so emitting `soapjournal.db` is opened by the app as
 * `createConnection("soapjournal")`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { validateCanonicalTranslation } from '@/lib/schema/canonical'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { loadTranslation, type TranslationCounts } from './loadTranslation'
import { runMigrations } from './migrations'

export interface BuildResult {
  translations: ({ code: string } & TranslationCounts)[]
}

export type BuildErrorKind =
  | 'input' // missing dir, no input files, or other IO problem -> exit 2
  | 'validation' // a file is not parseable / not valid canonical JSON -> exit 1

export class BuildError extends Error {
  kind: BuildErrorKind

  constructor(kind: BuildErrorKind, message: string) {
    super(message)
    this.name = 'BuildError'
    this.kind = kind
  }
}

export interface BuildOptions {
  inputDir: string
  outputDbPath: string
  /** ISO-8601 UTC written to translations.loaded_at; defaults to now. */
  loadedAt?: string
  /** Optional per-file progress callback (the CLI prints; tests stay quiet). */
  onProgress?: (message: string) => void
}

/**
 * Build the prebuilt DB from every `*.json` in `inputDir`, emitting it to
 * `outputDbPath`. Builds into a temp file and renames on success, so a failure
 * never leaves a half-written or stale asset (and writes nothing on a bad file).
 * Throws `BuildError` on input/validation problems.
 */
export async function buildBibleDb(opts: BuildOptions): Promise<BuildResult> {
  const { inputDir, outputDbPath, loadedAt, onProgress } = opts

  if (!existsSync(inputDir)) {
    throw new BuildError('input', `input directory does not exist: ${inputDir}`)
  }

  const files = readdirSync(inputDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  if (files.length === 0) {
    throw new BuildError('input', `no .json files found in ${inputDir}`)
  }

  // Build into a temp file; only the final rename publishes the asset.
  const tmpPath = `${outputDbPath}.building`
  const outputDir = join(outputDbPath, '..')
  mkdirSync(outputDir, { recursive: true })
  if (existsSync(tmpPath)) {
    rmSync(tmpPath)
  }

  const executor = createBetterSqliteExecutor(tmpPath)
  const result: BuildResult = { translations: [] }
  try {
    await runMigrations(executor)

    for (const file of files) {
      const path = join(inputDir, file)
      const raw = readFileSync(path, 'utf-8')

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        throw new BuildError('validation', `${file}: not valid JSON (${(err as Error).message})`)
      }

      const validation = validateCanonicalTranslation(parsed)
      if (!validation.success) {
        throw new BuildError('validation', `${file}: invalid canonical JSON:\n  ${validation.errors.join('\n  ')}`)
      }

      const counts = await loadTranslation(executor, validation.data, loadedAt)
      result.translations.push({ code: validation.data.code, ...counts })
      onProgress?.(
        `loaded ${validation.data.code}: ${counts.books} books, ${counts.chapters} chapters, ${counts.verses} verses`,
      )
    }

    await executor.close()
  } catch (err) {
    // Leave the existing asset untouched; discard the half-built temp.
    await executor.close().catch(() => undefined)
    if (existsSync(tmpPath)) {
      rmSync(tmpPath)
    }
    throw err
  }

  renameSync(tmpPath, outputDbPath)
  return result
}

/**
 * CLI wrapper: runs the build, prints progress/summary (stdout) and errors
 * (stderr), and returns an exit code mirroring the server's loader CLI:
 *   2 = input/IO problem (missing dir, no files)
 *   1 = validation problem (bad JSON / invalid canonical)
 *   0 = success
 * Returns the code (does not call process.exit) so it is unit-testable.
 */
export async function runBuildCli(opts: {
  inputDir: string
  outputDbPath: string
}): Promise<number> {
  try {
    const result = await buildBibleDb({
      ...opts,
      onProgress: (m) => console.log(m),
    })
    const totalVerses = result.translations.reduce((n, t) => n + t.verses, 0)
    console.log(
      `Built ${opts.outputDbPath}: ${result.translations.length} translations, ${totalVerses} verses total`,
    )
    return 0
  } catch (err) {
    if (err instanceof BuildError) {
      console.error(`error: ${err.message}`)
      return err.kind === 'input' ? 2 : 1
    }
    // Unexpected (e.g. IO) — treat as an input/environment failure.
    console.error(`error: ${(err as Error).message}`)
    return 2
  }
}
