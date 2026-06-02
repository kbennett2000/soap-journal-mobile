// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import type { DbExecutor } from './executor'

// Exercises the executor contract against the better-sqlite3 adapter (the one
// tests + the build script use). The Capacitor adapter shares the contract but
// is verified on-device in a later cycle.

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await db.execScript('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL);')
})

afterEach(async () => {
  await db.close()
})

describe('BetterSqliteExecutor', () => {
  it('run + query round-trip, with RunResult', async () => {
    const r = await db.run('INSERT INTO t (v) VALUES (?)', ['hello'])
    expect(r.changes).toBe(1)
    expect(r.lastInsertRowid).toBe(1)

    const rows = await db.query<{ id: number; v: string }>('SELECT * FROM t')
    expect(rows).toEqual([{ id: 1, v: 'hello' }])
  })

  it('query returns [] for an empty table', async () => {
    expect(await db.query('SELECT * FROM t')).toEqual([])
  })

  it('runMany bulk-inserts every row', async () => {
    await db.runMany('INSERT INTO t (v) VALUES (?)', [['a'], ['b'], ['c']])
    const rows = await db.query<{ v: string }>('SELECT v FROM t ORDER BY id')
    expect(rows.map((row) => row.v)).toEqual(['a', 'b', 'c'])
  })

  it('execScript runs multiple statements', async () => {
    await db.execScript(`
      INSERT INTO t (v) VALUES ('x');
      INSERT INTO t (v) VALUES ('y');
    `)
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM t')
    expect(n).toBe(2)
  })

  it('transaction commits on success', async () => {
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t (v) VALUES (?)', ['committed'])
      return 'ok'
    })
    expect(result).toBe('ok')
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM t')
    expect(n).toBe(1)
  })

  it('transaction rolls back on throw and re-raises', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t (v) VALUES (?)', ['doomed'])
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM t')
    expect(n).toBe(0)
  })
})
