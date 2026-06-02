/**
 * The database seam.
 *
 * Every repository, the migration runner, and the shared canonical-insert
 * routine are written against `DbExecutor` — never against a concrete driver.
 * Two adapters implement it: `BetterSqliteExecutor` (synchronous better-sqlite3,
 * used by tests and the build-bible-db script) and `CapacitorSqliteExecutor`
 * (the @capacitor-community/sqlite plugin, used on-device at runtime). Keeping
 * one async contract means the same SQL and the same logic run under both.
 *
 * SQL uses positional `?` placeholders, supported by both drivers.
 */

/** Result of a write statement (INSERT / UPDATE / DELETE). */
export interface RunResult {
  /** Number of rows affected. */
  changes: number
  /** Rowid of the last inserted row (0 when not an insert). */
  lastInsertRowid: number
}

export interface DbExecutor {
  /** Run a query and return all result rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>

  /** Run a single write statement and report rows affected + last insert id. */
  run(sql: string, params?: unknown[]): Promise<RunResult>

  /**
   * Run one prepared statement once per row of params — the batched path for
   * bulk inserts (e.g. ~31k verses). Atomicity is the caller's responsibility:
   * wrap it in `transaction` when all-or-nothing is required.
   */
  runMany(sql: string, rows: unknown[][]): Promise<void>

  /** Execute a multi-statement SQL script (DDL / migrations). No parameters. */
  execScript(sql: string): Promise<void>

  /**
   * Run `fn` inside a transaction: BEGIN, then COMMIT on success, or ROLLBACK
   * and re-throw on any error. Not re-entrant — SQLite has no nested
   * transactions, so do not call `transaction` from within `fn`.
   */
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>

  /** Close the underlying connection. */
  close(): Promise<void>
}
