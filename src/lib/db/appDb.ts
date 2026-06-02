import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'

import { createCapacitorExecutor } from './connection'
import type { DbExecutor } from './executor'
import { runMigrations } from './migrations'

/**
 * Production database bootstrap — the initializer `DbProvider` runs at startup
 * (on-device, via the @capacitor-community/sqlite plugin).
 *
 * Flow (docs/first-run-and-import.md):
 *   1. copyFromAssets(overwrite:false) — copy the prebuilt asset on the FIRST
 *      launch only; on later launches the working DB exists and this no-ops, so
 *      user data is never clobbered.
 *   2. open the "soapjournal" connection (the asset `soapjournal.db` is stored
 *      as `soapjournalSQLite.db` by the plugin's addSQLiteSuffix — the name
 *      contract this must use).
 *   3. PRAGMA foreign_keys = ON (per connection; createCapacitorExecutor sets it).
 *   4. runMigrations — advances user_version; a no-op when the asset is current.
 *
 * Any failure rejects, surfacing in DbProvider's error gate — never falls
 * through to an empty database. Tests never call this; they inject a
 * BetterSqliteExecutor-based initializer.
 */

const DB_NAME = 'soapjournal'

export async function initializeAppDb(): Promise<DbExecutor> {
  const sqlite = new SQLiteConnection(CapacitorSQLite)

  // First-launch (and update-safety) guard: copies the bundled asset only when
  // no working DB exists yet.
  await sqlite.copyFromAssets(false)

  // Reuse an already-open connection if present (DbProvider retry / re-init),
  // otherwise create it — avoids the plugin's "connection already exists".
  const exists = (await sqlite.isConnection(DB_NAME, false)).result ?? false
  const conn = exists
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)

  if (!(await conn.isDBOpen()).result) {
    await conn.open()
  }

  const executor = await createCapacitorExecutor(conn)
  await runMigrations(executor)
  return executor
}
