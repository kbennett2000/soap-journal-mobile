// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema, type CanonicalTranslation } from '@/lib/schema/canonical'
import type { EntryCreateRequest } from '@/types/api'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { saveEntry } from './entries'
import type { DbExecutor } from './executor'
import { loadTranslation } from './loadTranslation'
import { runMigrations } from './migrations'
import { autocompleteTags, listTags } from './tags'

// Re-expression of api/tags_test.py against BetterSqliteExecutor. Tags are
// seeded by saving tagged entries (the real get-or-create path), never by
// inserting tag rows directly. Auth/401 + cross-user-404 dropped (single
// user); the missing-q 422 dropped (framework). Real-BSB refs -> synthetic
// fixture refs (tag behavior is independent of which verse).

function verses(count: number, label: string): { number: number; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${label} ${i + 1}` }))
}

function buildTranslation(): CanonicalTranslation {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: [{ number: 1, verses: verses(1, spec.name) }],
  }))
  return CanonicalTranslationSchema.parse({
    code: 'TST',
    name: 'TST',
    language: 'en',
    copyright: '© TST',
    books,
  })
}

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
  await loadTranslation(db, buildTranslation())
})

afterEach(async () => {
  await db.close()
})

// Seed tags by saving a tagged entry (all refs use the minimal fixture).
async function tagged(tags: string[], scriptureRef = 'Genesis 1:1'): Promise<void> {
  const input: EntryCreateRequest = { scripture_ref: scriptureRef, tags }
  await saveEntry(db, input)
}

// ---- list ------------------------------------------------------------------

describe('listTags', () => {
  it('is empty for a fresh database', async () => {
    expect(await listTags(db)).toEqual({ tags: [] })
  })

  it('counts entries per tag', async () => {
    await tagged(['faith', 'grace'])
    await tagged(['faith', 'hope'])
    const counts = Object.fromEntries(
      (await listTags(db)).tags.map((t) => [t.name, t.entry_count]),
    )
    expect(counts).toEqual({ faith: 2, grace: 1, hope: 1 })
  })

  it('orders alphabetically, case-insensitively', async () => {
    await tagged(['zebra'])
    await tagged(['Apple'])
    await tagged(['mountain'])
    const names = (await listTags(db)).tags.map((t) => t.name)
    expect(names).toEqual(['Apple', 'mountain', 'zebra'])
  })
})

// ---- autocomplete ----------------------------------------------------------

describe('autocompleteTags', () => {
  it('orders by entry_count desc, then name', async () => {
    await tagged(['family'])
    await tagged(['faith'])
    await tagged(['faith'])
    const result = await autocompleteTags(db, 'fa')
    expect(result.tags.map((t) => t.name)).toEqual(['faith', 'family'])
    expect(result.tags.map((t) => t.entry_count)).toEqual([2, 1])
  })

  it('is case-insensitive on the query', async () => {
    await tagged(['Faith'])
    const result = await autocompleteTags(db, 'FA')
    expect(result.tags.length).toBe(1)
    expect(result.tags[0].name).toBe('Faith')
  })

  it('returns only prefix matches', async () => {
    await tagged(['faith'])
    await tagged(['unfailing'])
    const result = await autocompleteTags(db, 'fa')
    expect(result.tags.map((t) => t.name)).toEqual(['faith'])
  })

  it('caps results at 10', async () => {
    for (let i = 0; i < 15; i++) {
      await tagged([`foo-${String(i).padStart(2, '0')}`])
    }
    const result = await autocompleteTags(db, 'foo')
    expect(result.tags.length).toBe(10)
  })

  it('returns empty for an empty or whitespace-only query (divergence)', async () => {
    await tagged(['faith'])
    expect(await autocompleteTags(db, '')).toEqual({ tags: [] })
    expect(await autocompleteTags(db, '   ')).toEqual({ tags: [] })
  })
})
