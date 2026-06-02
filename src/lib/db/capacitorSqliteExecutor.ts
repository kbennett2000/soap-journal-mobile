/**
 * @capacitor-community/sqlite adapter for `DbExecutor`.
 *
 * The on-device runtime driver. Wraps an already-open `SQLiteDBConnection`.
 * Writes pass `transaction: false` so they compose inside our explicit
 * `transaction()` (and rely on SQLite autocommit otherwise) rather than each
 * call opening its own transaction.
 *
 * NOT unit-tested in this cycle (no device/emulator here) — it typechecks
 * against the installed plugin types (v8.1.0) and is exercised on-device in a
 * later cycle. Web caveat: the plugin needs `jeep-sqlite` for web; this app
 * targets Android only, so there is no web initialization path.
 */

import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

import type { DbExecutor, RunResult } from './executor'

export class CapacitorSqliteExecutor implements DbExecutor {
  constructor(private readonly conn: SQLiteDBConnection) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.conn.query(sql, params as never[])
    return (result.values ?? []) as T[]
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const result = await this.conn.run(sql, params as never[], false)
    return {
      changes: result.changes?.changes ?? 0,
      lastInsertRowid: result.changes?.lastId ?? 0,
    }
  }

  async runMany(sql: string, rows: unknown[][]): Promise<void> {
    const set = rows.map((values) => ({ statement: sql, values: values as never[] }))
    await this.conn.executeSet(set, false)
  }

  async execScript(sql: string): Promise<void> {
    await this.conn.execute(sql, false)
  }

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    await this.conn.beginTransaction()
    try {
      const result = await fn(this)
      await this.conn.commitTransaction()
      return result
    } catch (error) {
      await this.conn.rollbackTransaction()
      throw error
    }
  }

  async close(): Promise<void> {
    await this.conn.close()
  }
}
