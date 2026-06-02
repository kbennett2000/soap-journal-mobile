import type { DbExecutor } from './executor'

/**
 * Production database bootstrap — the initializer `DbProvider` runs at startup.
 *
 * PLACEHOLDER: not implemented yet. The device cycle replaces this body with the
 * real Capacitor flow — copy the prebuilt asset, open the connection, run
 * migrations, and return a `CapacitorSqliteExecutor`:
 *
 *   await copyFromAssets()                       // first launch only
 *   const conn = await createConnection('soapjournal', …)
 *   await conn.open()
 *   const executor = await createCapacitorExecutor(conn)  // sets PRAGMA foreign_keys = ON
 *   await runMigrations(executor)
 *   return executor
 *
 * Until then the app shows DbProvider's error gate on device. Tests never call
 * this — they inject a BetterSqliteExecutor-based initializer.
 */
export function initializeAppDb(): Promise<DbExecutor> {
  return Promise.reject(
    new Error('Database bootstrap is not implemented yet (pending the device cycle).'),
  )
}
