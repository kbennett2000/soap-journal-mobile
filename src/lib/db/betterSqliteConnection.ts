/**
 * better-sqlite3 connection factory — tests and the build-bible-db script only.
 *
 * Kept separate from `connection.ts` (the app's Capacitor path) so the native
 * addon is never pulled into the app's import graph and thus never bundled into
 * the WebView. Import this only from `*.test.ts` and `scripts/`.
 */

import Database from 'better-sqlite3'

import { BetterSqliteExecutor } from './betterSqliteExecutor'
import type { DbExecutor } from './executor'

/**
 * Open a better-sqlite3 database and return a `DbExecutor` with foreign keys
 * enforced. Use ':memory:' for tests, a file path for the build script.
 */
export function createBetterSqliteExecutor(filename: string): DbExecutor {
  const db = new Database(filename)
  db.pragma('foreign_keys = ON')
  return new BetterSqliteExecutor(db)
}
