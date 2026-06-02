// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'

import type { Backup, BackupEntry } from '@/lib/schema/backup'
import { getBookByName } from '@/lib/bible/books'
import { makeEntriesInitializer, type SeedEntry } from '@/test/entriesSeed'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { buildBackup } from './journalExport'
import { listEntries } from './entries'
import type { DbExecutor, RunResult } from './executor'
import { RestoreError, restoreBackupFromText, restoreJournal } from './journalRestore'
import { runMigrations } from './migrations'

const EXPORTED_AT = '2026-06-02T00:00:00.000Z'
const JOHN = getBookByName('John')!.order_index

const opened: DbExecutor[] = []
afterEach(async () => {
  while (opened.length) await opened.pop()!.close()
})

/** A migrated DB with NO translation loaded (proves Model B self-containment). */
async function freshDb(): Promise<DbExecutor> {
  const db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
  opened.push(db)
  return db
}

/** A DB seeded through the real saveEntry path (has the synthetic translation). */
async function seededDb(seed: SeedEntry[]): Promise<DbExecutor> {
  const db = await makeEntriesInitializer(seed)()
  opened.push(db)
  return db
}

function makeEntry(o: Partial<BackupEntry> = {}): BackupEntry {
  return {
    title: o.title ?? null,
    entry_date: o.entry_date ?? '2026-05-20',
    scripture_ref: o.scripture_ref ?? 'John 1:1',
    scripture_translation_code: o.scripture_translation_code ?? 'ESV',
    scripture_text: o.scripture_text ?? 'snapshot text',
    observation: o.observation ?? '',
    application: o.application ?? '',
    prayer: o.prayer ?? '',
    created_at: o.created_at ?? '2026-05-20T08:00:00.000Z',
    updated_at: o.updated_at ?? '2026-05-20T08:00:00.000Z',
    verses: o.verses ?? [{ book_order_index: JOHN, chapter: 1, verse: 1 }],
    tags: o.tags ?? [],
  }
}

function makeBackup(entries: BackupEntry[]): Backup {
  return { format: 'soap-journal-backup', version: 1, exported_at: EXPORTED_AT, entries }
}

async function expectRestoreError(p: Promise<unknown>, kind: RestoreError['kind']): Promise<void> {
  let caught: unknown
  try {
    await p
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(RestoreError)
  expect((caught as RestoreError).kind).toBe(kind)
}

const ROUND_TRIP: SeedEntry[] = [
  {
    input: {
      scripture_ref: 'John 1:1-3',
      title: 'Multi',
      observation: 'o',
      application: 'a',
      prayer: 'p',
      tags: ['grace', 'faith'],
      entry_date: '2026-05-20',
    },
    now: '2026-05-20T08:12:00.000Z',
  },
  {
    input: { scripture_ref: 'Genesis 1:2', tags: [], entry_date: '2026-01-01' },
    now: '2026-01-01T00:00:00.000Z',
  },
]

describe('restoreJournal', () => {
  it('round-trips: export → wipe → restore yields an identical journal', async () => {
    const db = await seededDb(ROUND_TRIP)
    const before = await buildBackup(db, EXPORTED_AT)
    await restoreJournal(db, before, '2026-06-02T10:00:00.000Z')
    const after = await buildBackup(db, EXPORTED_AT)
    // Entries, tags, coordinates, verbatim timestamps, snapshot text — all equal.
    expect(after).toEqual(before)
  })

  it('replaces (not merges): only the backup’s entries and tags remain', async () => {
    const db = await seededDb([
      { input: { scripture_ref: 'John 1:1', title: 'Old', tags: ['alpha'] } },
    ])
    const backup = makeBackup([makeEntry({ title: 'New', tags: ['beta'] })])
    await restoreJournal(db, backup)

    const after = await buildBackup(db, EXPORTED_AT)
    expect(after.entries.map((e) => e.title)).toEqual(['New'])
    const tagNames = (await db.query<{ name: string }>('SELECT name FROM tags ORDER BY name')).map(
      (t) => t.name,
    )
    expect(tagNames).toEqual(['beta']) // 'alpha' is gone
  })

  it('restores an empty backup to an empty journal', async () => {
    const db = await seededDb(ROUND_TRIP)
    await restoreJournal(db, makeBackup([]))
    const after = await buildBackup(db, EXPORTED_AT)
    expect(after.entries).toEqual([])
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM tags')
    expect(n).toBe(0)
  })

  it('restores with NO translation loaded (Model B self-containment)', async () => {
    const db = await freshDb() // migrated, no loadTranslation
    const backup = makeBackup([
      makeEntry({
        scripture_translation_code: 'ESV',
        scripture_text: 'For God so loved the world',
        scripture_ref: 'John 3:16',
        verses: [{ book_order_index: JOHN, chapter: 3, verse: 16 }],
        tags: ['faith'],
      }),
    ])
    await restoreJournal(db, backup)

    const after = await buildBackup(db, EXPORTED_AT)
    expect(after.entries).toHaveLength(1)
    expect(after.entries[0]).toMatchObject({
      scripture_translation_code: 'ESV',
      scripture_text: 'For God so loved the world',
      verses: [{ book_order_index: JOHN, chapter: 3, verse: 16 }],
      tags: ['faith'],
    })
    // And it reads back through the normal list path.
    const list = await listEntries(db, {})
    expect(list.total).toBe(1)
  })
})

describe('restoreBackupFromText — validate-before-destroy', () => {
  it('rejects malformed / schema-invalid / newer-version files and changes NOTHING', async () => {
    const db = await seededDb(ROUND_TRIP)
    const snapshot = await buildBackup(db, EXPORTED_AT)

    await expectRestoreError(restoreBackupFromText(db, 'not json {'), 'parse')
    expect(await buildBackup(db, EXPORTED_AT)).toEqual(snapshot)

    await expectRestoreError(
      restoreBackupFromText(
        db,
        JSON.stringify({ format: 'soap-journal-backup', version: 1, exported_at: 'x', entries: [{ bad: true }] }),
      ),
      'validation',
    )
    expect(await buildBackup(db, EXPORTED_AT)).toEqual(snapshot)

    await expectRestoreError(
      restoreBackupFromText(
        db,
        JSON.stringify({ format: 'soap-journal-backup', version: 2, exported_at: 'x', entries: [] }),
      ),
      'version',
    )
    expect(await buildBackup(db, EXPORTED_AT)).toEqual(snapshot)
  })
})

describe('restoreJournal — transactional rollback', () => {
  it('rolls back the whole restore on a mid-insert failure', async () => {
    const inner = await seededDb([
      { input: { scripture_ref: 'John 1:1', title: 'Survivor', tags: ['keep'] } },
    ])
    const snapshot = await buildBackup(inner, EXPORTED_AT)

    // Backup with two entries; the spy throws on the SECOND entry insert.
    const backup = makeBackup([
      makeEntry({ title: 'B1', tags: ['x'] }),
      makeEntry({ title: 'B2', tags: ['y'] }),
    ])

    const spy = new SpyingExecutor(inner, 2)
    await expectRestoreError(restoreJournal(spy, backup), 'restore')

    // The wipe + the first insert were rolled back — journal is exactly as before.
    expect(await buildBackup(inner, EXPORTED_AT)).toEqual(snapshot)
  })
})

/**
 * Wraps an executor and throws on the Nth `INSERT INTO entries`. `transaction`
 * delegates BEGIN/COMMIT/ROLLBACK to the inner executor but passes THIS proxy as
 * the tx, so the throwing `run` fires inside the real transaction.
 */
class SpyingExecutor implements DbExecutor {
  private entryInserts = 0
  constructor(
    private readonly inner: DbExecutor,
    private readonly failOnEntryInsert: number,
  ) {}

  async run(sql: string, params?: unknown[]): Promise<RunResult> {
    if (/INSERT INTO entries\b/i.test(sql)) {
      this.entryInserts += 1
      if (this.entryInserts === this.failOnEntryInsert) {
        throw new Error('simulated write failure')
      }
    }
    return this.inner.run(sql, params)
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.inner.query<T>(sql, params)
  }
  runMany(sql: string, rows: unknown[][]): Promise<void> {
    return this.inner.runMany(sql, rows)
  }
  execScript(sql: string): Promise<void> {
    return this.inner.execScript(sql)
  }
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.inner.transaction(() => fn(this))
  }
  close(): Promise<void> {
    return this.inner.close()
  }
}
