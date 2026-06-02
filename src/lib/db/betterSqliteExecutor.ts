/**
 * better-sqlite3 adapter for `DbExecutor`.
 *
 * Synchronous driver wrapped in the async contract. Used by Vitest and the
 * build-bible-db script (cycle 5) — NOT by the app. It must never be imported
 * from the app's runtime graph (`main.tsx` → …), or Vite would try to bundle
 * the native addon into the WebView. Keep it reachable only from tests and
 * build scripts.
 */

import type { Database } from 'better-sqlite3'

import type { DbExecutor, RunResult } from './executor'

export class BetterSqliteExecutor implements DbExecutor {
  constructor(private readonly db: Database) {}

  // Methods are `async` (not just Promise-returning) so a synchronous
  // better-sqlite3 throw surfaces as a rejected promise — honoring the async
  // `DbExecutor` contract that callers `await`, same as the Capacitor adapter.

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[]
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const info = this.db.prepare(sql).run(...params)
    return {
      changes: info.changes,
      lastInsertRowid: Number(info.lastInsertRowid),
    }
  }

  async runMany(sql: string, rows: unknown[][]): Promise<void> {
    // Prepare once, execute per row. Atomicity is the caller's job (wrap in
    // `transaction`); this only buys the prepared-statement speedup.
    const stmt = this.db.prepare(sql)
    for (const row of rows) {
      stmt.run(...row)
    }
  }

  async execScript(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    // Manual BEGIN/COMMIT rather than better-sqlite3's `db.transaction`, which
    // forbids async work inside it. Every underlying call is synchronous, so
    // the awaited `fn` settles before COMMIT runs.
    this.db.exec('BEGIN')
    try {
      const result = await fn(this)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
