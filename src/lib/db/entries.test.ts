// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema, type CanonicalTranslation } from '@/lib/schema/canonical'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { deleteEntry, getEntry, saveEntry } from './entries'
import { ApiError } from './errors'
import type { DbExecutor } from './executor'
import { loadTranslation } from './loadTranslation'
import { runMigrations } from './migrations'

// Re-expression of api/entries_test.py against BetterSqliteExecutor + a
// synthetic translation. Auth/401 + cross-user-404 tests dropped (single user).
// 422 request-validation (tag maxlen/control, title>200, limit) is a form-layer
// concern, out of scope for the write repository. Verse linkage is asserted as
// Model B coordinates (the server checked verse_id rows).

function verses(count: number, label: string): { number: number; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${label} ${i + 1}` }))
}

const OVERRIDES: Record<string, { number: number; verses: { number: number; text: string }[] }[]> =
  {
    Genesis: [{ number: 1, verses: verses(5, 'Gen 1') }],
  }

function buildTranslation(code = 'TST'): CanonicalTranslation {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: OVERRIDES[spec.name] ?? [{ number: 1, verses: verses(1, spec.name) }],
  }))
  return CanonicalTranslationSchema.parse({
    code,
    name: code,
    language: 'en',
    copyright: `© ${code}`,
    books,
  })
}

const T0 = '2026-06-02T12:00:00.000Z'
const T1 = '2026-06-02T12:00:01.000Z'

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
  await loadTranslation(db, buildTranslation('TST'))
})

afterEach(async () => {
  await db.close()
})

async function coordinates(entryId: number): Promise<[number, number, number][]> {
  const rows = await db.query<{
    book_order_index: number
    chapter_number: number
    verse_number: number
  }>(
    'SELECT book_order_index, chapter_number, verse_number FROM entry_scripture_verses WHERE entry_id = ? ORDER BY verse_number',
    [entryId],
  )
  return rows.map((r) => [r.book_order_index, r.chapter_number, r.verse_number])
}

// ---- create ----------------------------------------------------------------

describe('saveEntry — create', () => {
  it('minimal payload', async () => {
    const entry = await saveEntry(db, { scripture_ref: 'Genesis 1:1' }, undefined, T0)
    expect(entry.title).toBeNull()
    expect(entry.display_title).toBe('Genesis 1:1')
    expect(entry.entry_date).toBe('2026-06-02')
    expect(entry.scripture_ref).toBe('Genesis 1:1')
    expect(entry.translation_code).toBe('TST')
    expect(entry.scripture_text).toBe('Gen 1 1')
    expect(entry.observation).toBe('')
    expect(entry.application).toBe('')
    expect(entry.prayer).toBe('')
    expect(entry.tags).toEqual([])
    expect(entry.created_at).toBe(T0)
    expect(entry.updated_at).toBe(T0)
  })

  it('full payload', async () => {
    const entry = await saveEntry(
      db,
      {
        title: 'On grace',
        entry_date: '2026-01-15',
        scripture_ref: 'Genesis 1:2-4',
        observation: 'obs',
        application: 'app',
        prayer: 'pray',
        tags: ['faith', 'grace'],
      },
      undefined,
      T0,
    )
    expect(entry.title).toBe('On grace')
    expect(entry.display_title).toBe('On grace')
    expect(entry.entry_date).toBe('2026-01-15')
    expect(entry.scripture_ref).toBe('Genesis 1:2-4')
    expect(entry.scripture_text).toBe('Gen 1 2 Gen 1 3 Gen 1 4')
    expect(new Set(entry.tags.map((t) => t.name))).toEqual(new Set(['faith', 'grace']))
  })

  it('normalizes the scripture reference', async () => {
    const entry = await saveEntry(db, { scripture_ref: 'gen 1:2-4' }, undefined, T0)
    expect(entry.scripture_ref).toBe('Genesis 1:2-4')
  })

  it('whole chapter links every verse', async () => {
    const entry = await saveEntry(db, { scripture_ref: 'Genesis 1' }, undefined, T0)
    expect(entry.scripture_ref).toBe('Genesis 1')
    expect((await coordinates(entry.id)).length).toBe(5)
    expect(entry.scripture_text).toBe('Gen 1 1 Gen 1 2 Gen 1 3 Gen 1 4 Gen 1 5')
  })

  it('writes exact Model B coordinate rows', async () => {
    const entry = await saveEntry(db, { scripture_ref: 'Genesis 1:2-4' }, undefined, T0)
    expect(await coordinates(entry.id)).toEqual([
      [1, 1, 2],
      [1, 1, 3],
      [1, 1, 4],
    ])
  })
})

// ---- validation errors -----------------------------------------------------

describe('saveEntry — validation errors', () => {
  it('bad reference -> INVALID_REFERENCE (400)', async () => {
    await expect(saveEntry(db, { scripture_ref: 'Frodo 3:16' }, undefined, T0)).rejects.toMatchObject(
      { code: 'INVALID_REFERENCE', status: 400 },
    )
  })

  it('verse out of range -> REFERENCE_OUT_OF_RANGE (404)', async () => {
    await expect(
      saveEntry(db, { scripture_ref: 'Genesis 1:99' }, undefined, T0),
    ).rejects.toMatchObject({ code: 'REFERENCE_OUT_OF_RANGE', status: 404 })
  })

  it('chapter out of range -> CHAPTER_NOT_FOUND (404)', async () => {
    await expect(saveEntry(db, { scripture_ref: 'Genesis 99' }, undefined, T0)).rejects.toMatchObject(
      { code: 'CHAPTER_NOT_FOUND', status: 404 },
    )
  })

  it('unknown translation -> TRANSLATION_NOT_FOUND (404)', async () => {
    await expect(
      saveEntry(db, { scripture_ref: 'Genesis 1:1', translation_code: 'NOPE' }, undefined, T0),
    ).rejects.toMatchObject({ code: 'TRANSLATION_NOT_FOUND', status: 404 })
  })

  it('throws ApiError instances', async () => {
    await expect(saveEntry(db, { scripture_ref: 'Frodo 3:16' }, undefined, T0)).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})

// ---- tags on save ----------------------------------------------------------

describe('saveEntry — tags', () => {
  it('dedupes case-insensitively, first casing wins', async () => {
    const entry = await saveEntry(
      db,
      { scripture_ref: 'Genesis 1:1', tags: ['Faith', 'FAITH', 'faith'] },
      undefined,
      T0,
    )
    expect(entry.tags.length).toBe(1)
    expect(entry.tags[0].name).toBe('Faith')
  })

  it('reuses an existing tag case-insensitively, keeping its first casing', async () => {
    const first = await saveEntry(db, { scripture_ref: 'Genesis 1:1', tags: ['Faith'] }, undefined, T0)
    const second = await saveEntry(db, { scripture_ref: 'Genesis 1:2', tags: ['faith'] }, undefined, T0)
    expect(second.tags[0].id).toBe(first.tags[0].id)
    expect(second.tags[0].name).toBe('Faith')
  })

  it('trims tag whitespace', async () => {
    const entry = await saveEntry(db, { scripture_ref: 'Genesis 1:1', tags: ['  hope  '] }, undefined, T0)
    expect(entry.tags[0].name).toBe('hope')
  })
})

// ---- get -------------------------------------------------------------------

describe('getEntry', () => {
  it('round-trips the full payload incl. tags', async () => {
    const created = await saveEntry(
      db,
      { scripture_ref: 'Genesis 1:1', title: 'Hope', tags: ['faith'] },
      undefined,
      T0,
    )
    const fetched = await getEntry(db, created.id)
    expect(fetched.id).toBe(created.id)
    expect(fetched.title).toBe('Hope')
    expect(fetched.tags.map((t) => t.name)).toEqual(['faith'])
  })

  it('unknown id -> ENTRY_NOT_FOUND', async () => {
    await expect(getEntry(db, 9999)).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND', status: 404 })
  })
})

// ---- update ----------------------------------------------------------------

describe('saveEntry — update', () => {
  it('replaces all fields (PUT is replace-not-patch)', async () => {
    const created = await saveEntry(
      db,
      {
        title: 'First',
        scripture_ref: 'Genesis 1:1',
        observation: 'o',
        application: 'a',
        prayer: 'p',
        tags: ['faith'],
      },
      undefined,
      T0,
    )
    const updated = await saveEntry(db, { scripture_ref: 'Genesis 1:2' }, created.id, T1)
    expect(updated.id).toBe(created.id)
    expect(updated.title).toBeNull()
    expect(updated.scripture_ref).toBe('Genesis 1:2')
    expect(updated.observation).toBe('')
    expect(updated.application).toBe('')
    expect(updated.prayer).toBe('')
    expect(updated.tags).toEqual([])
  })

  it('rebuilds verse links on a reference change', async () => {
    const created = await saveEntry(db, { scripture_ref: 'Genesis 1:2' }, undefined, T0)
    expect((await coordinates(created.id)).length).toBe(1)
    const updated = await saveEntry(db, { scripture_ref: 'Genesis 1:2-4' }, created.id, T1)
    expect(await coordinates(updated.id)).toEqual([
      [1, 1, 2],
      [1, 1, 3],
      [1, 1, 4],
    ])
  })

  it('bumps updated_at but not created_at', async () => {
    const created = await saveEntry(db, { scripture_ref: 'Genesis 1:1' }, undefined, T0)
    const updated = await saveEntry(db, { scripture_ref: 'Genesis 1:2' }, created.id, T1)
    expect(updated.created_at).toBe(T0)
    expect(updated.updated_at).toBe(T1)
  })

  it('unknown id -> ENTRY_NOT_FOUND', async () => {
    await expect(saveEntry(db, { scripture_ref: 'Genesis 1:1' }, 9999, T0)).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
    })
  })

  it('a failed update leaves the existing entry unchanged (atomic rollback)', async () => {
    const created = await saveEntry(
      db,
      { scripture_ref: 'Genesis 1:1', title: 'Keep me', tags: ['faith'] },
      undefined,
      T0,
    )
    await expect(
      saveEntry(db, { scripture_ref: 'Frodo 3:16' }, created.id, T1),
    ).rejects.toBeInstanceOf(ApiError)

    const after = await getEntry(db, created.id)
    expect(after.title).toBe('Keep me')
    expect(after.scripture_ref).toBe('Genesis 1:1')
    expect(after.updated_at).toBe(T0)
    expect(after.tags.map((t) => t.name)).toEqual(['faith'])
    expect((await coordinates(created.id)).length).toBe(1)
  })
})

// ---- delete ----------------------------------------------------------------

describe('deleteEntry', () => {
  it('removes the entry and its link rows, keeps orphaned tags', async () => {
    const created = await saveEntry(
      db,
      { scripture_ref: 'Genesis 1:2-4', tags: ['lonely'] },
      undefined,
      T0,
    )
    await deleteEntry(db, created.id)

    expect((await db.query('SELECT id FROM entries WHERE id = ?', [created.id])).length).toBe(0)
    expect((await coordinates(created.id)).length).toBe(0)
    expect(
      (await db.query('SELECT entry_id FROM entry_tags WHERE entry_id = ?', [created.id])).length,
    ).toBe(0)
    // Orphaned tag row persists (for autocomplete).
    const tags = await db.query<{ name: string }>('SELECT name FROM tags WHERE name = ?', ['lonely'])
    expect(tags.length).toBe(1)
  })

  it('unknown id -> ENTRY_NOT_FOUND', async () => {
    await expect(deleteEntry(db, 9999)).rejects.toMatchObject({
      code: 'ENTRY_NOT_FOUND',
      status: 404,
    })
  })
})
