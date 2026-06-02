// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getBookByName } from '@/lib/bible/books'
import { validateBackup } from '@/lib/schema/backup'
import { makeEntriesInitializer, type SeedEntry } from '@/test/entriesSeed'

import type { DbExecutor } from './executor'
import { buildBackup } from './journalExport'

// Multi-verse ref + tags so coordinates are non-trivial; pinned timestamps so we
// can assert they round-trip verbatim. (The synthetic translation has John 1:1–3.)
const SEED: SeedEntry[] = [
  {
    input: {
      scripture_ref: 'John 1:1-3',
      title: 'Multi note',
      observation: 'obs',
      application: 'app',
      prayer: 'pray',
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

const EXPORTED_AT = '2026-06-02T14:00:00.000Z'
const JOHN = getBookByName('John')!.order_index
const GENESIS = getBookByName('Genesis')!.order_index

let db: DbExecutor

afterEach(async () => {
  await db.close()
})

describe('buildBackup', () => {
  beforeEach(async () => {
    db = await makeEntriesInitializer(SEED)()
  })

  it('produces a valid, versioned backup document', async () => {
    const backup = await buildBackup(db, EXPORTED_AT)
    expect(backup.format).toBe('soap-journal-backup')
    expect(backup.version).toBe(1)
    expect(backup.exported_at).toBe(EXPORTED_AT)
    expect(backup.entries).toHaveLength(2)
    expect(validateBackup(backup).success).toBe(true)
  })

  it('serializes an entry with its fields, tags, coordinates, and verbatim timestamps', async () => {
    const backup = await buildBackup(db, EXPORTED_AT)
    const [first] = backup.entries // insertion order (id ASC)

    expect(first).toMatchObject({
      title: 'Multi note',
      entry_date: '2026-05-20',
      scripture_ref: 'John 1:1-3',
      scripture_translation_code: 'TST',
      observation: 'obs',
      application: 'app',
      prayer: 'pray',
      created_at: '2026-05-20T08:12:00.000Z',
      updated_at: '2026-05-20T08:12:00.000Z',
    })
    // Snapshot text (the joined verse texts at save time).
    expect(first!.scripture_text).toContain('John 1:1')
    // Tags as sorted names (no ids).
    expect(first!.tags).toEqual(['faith', 'grace'])
    // Exact coordinate tuples (short field names), one per verse in the range.
    expect(first!.verses).toEqual([
      { book_order_index: JOHN, chapter: 1, verse: 1 },
      { book_order_index: JOHN, chapter: 1, verse: 2 },
      { book_order_index: JOHN, chapter: 1, verse: 3 },
    ])
  })

  it('handles a null title, empty tags, and a single-verse coordinate', async () => {
    const backup = await buildBackup(db, EXPORTED_AT)
    const second = backup.entries[1]!
    expect(second.title).toBeNull()
    expect(second.tags).toEqual([])
    expect(second.verses).toEqual([{ book_order_index: GENESIS, chapter: 1, verse: 2 }])
  })

  it('returns a valid backup with no entries for an empty journal', async () => {
    await db.close()
    db = await makeEntriesInitializer([])()
    const backup = await buildBackup(db, EXPORTED_AT)
    expect(backup.entries).toEqual([])
    expect(validateBackup(backup).success).toBe(true)
  })
})
