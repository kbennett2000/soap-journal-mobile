/**
 * Connection factories.
 *
 * Each returns a ready-to-use `DbExecutor` with `PRAGMA foreign_keys = ON`
 * already set — SQLite defaults it OFF, and it is per-connection, so every open
 * connection must set it (and outside any transaction, where the pragma is a
 * no-op). See docs/schema.md and docs/first-run-and-import.md.
 *
 * The two factories live in separate modules on purpose: the better-sqlite3
 * path is imported only by tests and the build script, never by the app, so
 * the native addon never reaches the WebView bundle. The Capacitor factory is
 * the app's runtime path.
 */

import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

import { CapacitorSqliteExecutor } from './capacitorSqliteExecutor'
import type { DbExecutor } from './executor'

/**
 * Wrap an already-open plugin connection as a `DbExecutor`. Creating/opening
 * the connection (createConnection → open) and the first-launch asset copy are
 * the startup cycle's responsibility; here we just enforce the pragma.
 */
export async function createCapacitorExecutor(
  conn: SQLiteDBConnection,
): Promise<DbExecutor> {
  const executor = new CapacitorSqliteExecutor(conn)
  await executor.execScript('PRAGMA foreign_keys = ON;')
  return executor
}
