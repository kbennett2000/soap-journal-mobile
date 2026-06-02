// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema, type CanonicalTranslation } from '@/lib/schema/canonical'
import type { EntryCreateRequest } from '@/types/api'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { calendar, getPassageEntries, listEntries, onThisDay, saveEntry } from './entries'
import type { DbExecutor, RunResult } from './executor'
import { loadTranslation } from './loadTranslation'
import { runMigrations } from './migrations'

// Re-expression of entries_retrieval_test.py + bible_passages_test.py against
// BetterSqliteExecutor, entries seeded via cycle-7a saveEntry. Auth/401 +
// cross-user-404 dropped (single user); limit>100 / month=13 422s dropped
// (request validation). Real-BSB text/counts -> synthetic fixture;
// passage-entries verse-range overlap -> chapter-level coordinate match.

function verses(count: number, label: string): { number: number; text: string }[] {
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${label} ${i + 1}` }))
}

const OVERRIDES: Record<string, { number: number; verses: { number: number; text: string }[] }[]> =
  {
    Genesis: [
      { number: 1, verses: verses(5, 'Gen 1') },
      { number: 2, verses: verses(5, 'Gen 2') },
      { number: 3, verses: verses(20, 'Gen 3') },
    ],
    John: [{ number: 1, verses: verses(5, 'John 1') }],
  }

function buildTranslation(code: string): CanonicalTranslation {
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

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
  await loadTranslation(db, buildTranslation('TST'))
})

afterEach(async () => {
  await db.close()
})

// Seed helper: saveEntry with a pinned timestamp so ordering is deterministic.
let seq = 0
async function seed(input: EntryCreateRequest): Promise<void> {
  seq += 1
  const now = `2026-06-02T12:00:${String(seq).padStart(2, '0')}.000Z`
  await saveEntry(db, input, undefined, now)
}

class CountingExecutor implements DbExecutor {
  queries: string[] = []
  constructor(private readonly inner: DbExecutor) {}
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push(sql)
    return this.inner.query<T>(sql, params)
  }
  run(sql: string, params?: unknown[]): Promise<RunResult> {
    return this.inner.run(sql, params)
  }
  runMany(sql: string, rows: unknown[][]): Promise<void> {
    return this.inner.runMany(sql, rows)
  }
  execScript(sql: string): Promise<void> {
    return this.inner.execScript(sql)
  }
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.inner.transaction(fn)
  }
  close(): Promise<void> {
    return this.inner.close()
  }
}

// A small, varied seed across John, Romans, Psalms; tags faith/grace/family;
// dates spread across 2024-2026 (mirrors the oracle's SEED_SPEC).
async function seedDefault(): Promise<void> {
  await seed({
    scripture_ref: 'John 1:1',
    title: 'Love defined',
    observation: 'God so loved.',
    tags: ['faith', 'grace'],
    entry_date: '2026-05-26',
  })
  await seed({
    scripture_ref: 'John 1:2-3',
    observation: 'Not condemnation.',
    application: 'Trust Him.',
    tags: ['faith'],
    entry_date: '2026-05-20',
  })
  await seed({
    scripture_ref: 'Romans 1:1',
    title: 'Working for good',
    prayer: 'help me trust the love at work.',
    tags: ['faith', 'family'],
    entry_date: '2025-08-15',
  })
  await seed({
    scripture_ref: 'Psalm 1:1',
    observation: 'Shepherd imagery.',
    tags: ['family'],
    entry_date: '2024-12-25',
  })
  await seed({
    scripture_ref: 'John 1:1',
    title: 'The Word',
    observation: 'In the beginning.',
    tags: ['grace'],
    entry_date: '2024-05-26',
  })
}

// ---- filters ---------------------------------------------------------------

describe('listEntries — filters', () => {
  it('no filters returns all, with an empty applied_filters echo', async () => {
    await seedDefault()
    const body = await listEntries(db, {})
    expect(body.total).toBe(5)
    expect(body.applied_filters).toEqual({
      q: null,
      book: null,
      tag: null,
      from_date: null,
      to_date: null,
    })
  })

  it('q matches each text field, case-insensitively', async () => {
    await seedDefault()
    expect((await listEntries(db, { q: 'Love defined' })).total).toBe(1) // title
    expect((await listEntries(db, { q: 'Shepherd imagery' })).total).toBe(1) // observation
    expect((await listEntries(db, { q: 'Trust Him.' })).total).toBe(1) // application
    expect((await listEntries(db, { q: 'help me trust' })).total).toBe(1) // prayer
    expect((await listEntries(db, { q: 'Psalms 1' })).total).toBe(1) // scripture_text snapshot
    expect((await listEntries(db, { q: 'LOVE DEFINED' })).total).toBe(1) // case-insensitive
  })

  it('whitespace-only q is treated as absent', async () => {
    await seedDefault()
    const body = await listEntries(db, { q: '   ' })
    expect(body.total).toBe(5)
    expect(body.applied_filters.q).toBeNull()
  })

  it('escapes LIKE wildcards so q is a literal substring', async () => {
    await seed({ scripture_ref: 'John 1:1', observation: 'discount 50% today' })
    await seed({ scripture_ref: 'John 1:1', observation: '500 dollars saved' })
    // "50%" must match only the literal "50%", not "500" (which an unescaped
    // "%50%%" pattern would catch).
    const body = await listEntries(db, { q: '50%' })
    expect(body.total).toBe(1)
    expect(body.entries[0].observation).toBe('discount 50% today')
  })

  it('escapes the underscore wildcard', async () => {
    await seed({ scripture_ref: 'John 1:1', observation: 'field_name here' })
    await seed({ scripture_ref: 'John 1:1', observation: 'fieldXname here' })
    const body = await listEntries(db, { q: 'field_name' })
    expect(body.total).toBe(1)
    expect(body.entries[0].observation).toBe('field_name here')
  })

  it('book filter resolves canonical + alias and echoes canonical', async () => {
    await seedDefault()
    const canonical = await listEntries(db, { book: 'John' })
    expect(canonical.total).toBe(3)
    expect(canonical.applied_filters.book).toBe('John')
    const alias = await listEntries(db, { book: 'Jn' })
    expect(alias.total).toBe(3)
    expect(alias.applied_filters.book).toBe('John')
  })

  it('unknown book -> INVALID_BOOK (400)', async () => {
    await expect(listEntries(db, { book: 'Frodo' })).rejects.toMatchObject({
      code: 'INVALID_BOOK',
      status: 400,
    })
  })

  it('tag filter is case-insensitive and echoes the submitted casing', async () => {
    await seedDefault()
    const body = await listEntries(db, { tag: 'FAITH' })
    expect(body.total).toBe(3)
    expect(body.applied_filters.tag).toBe('FAITH')
  })

  it('unknown tag returns empty', async () => {
    await seedDefault()
    const body = await listEntries(db, { tag: 'doesnotexist' })
    expect(body.total).toBe(0)
    expect(body.entries).toEqual([])
  })

  it('date range is inclusive; inverted range -> INVALID_DATE_RANGE (400)', async () => {
    await seedDefault()
    const body = await listEntries(db, { from_date: '2025-01-01', to_date: '2026-12-31' })
    expect(body.total).toBe(3)
    await expect(
      listEntries(db, { from_date: '2025-12-31', to_date: '2025-01-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', status: 400 })
  })

  it('filters compose (book AND tag)', async () => {
    await seedDefault()
    const body = await listEntries(db, { book: 'John', tag: 'faith' })
    // John entries tagged faith: "Love defined" + "John 1:2-3" = 2.
    expect(body.total).toBe(2)
  })
})

// ---- ordering / pagination -------------------------------------------------

describe('listEntries — ordering & pagination', () => {
  beforeEach(async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2026-05-26' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2026-05-20' })
    await seed({ scripture_ref: 'John 1:3', entry_date: '2026-05-10' })
  })

  it('defaults to newest first', async () => {
    const dates = (await listEntries(db, {})).entries.map((e) => e.entry_date)
    expect(dates).toEqual(['2026-05-26', '2026-05-20', '2026-05-10'])
  })

  it('oldest reverses', async () => {
    const dates = (await listEntries(db, { order: 'oldest' })).entries.map((e) => e.entry_date)
    expect(dates).toEqual(['2026-05-10', '2026-05-20', '2026-05-26'])
  })

  it('paginates with limit + offset', async () => {
    const page1 = await listEntries(db, { limit: 2, offset: 0 })
    expect(page1.total).toBe(3)
    expect(page1.entries.length).toBe(2)
    const page2 = await listEntries(db, { limit: 2, offset: 2 })
    expect(page2.entries.length).toBe(1)
  })
})

describe('listEntries — no N+1', () => {
  it('issues the same number of queries regardless of result count', async () => {
    await seedDefault()
    const all = new CountingExecutor(db)
    await listEntries(all, {})
    const filtered = new CountingExecutor(db)
    await listEntries(filtered, { book: 'John' })
    // count + page + one batched tags query, independent of row count.
    expect(all.queries.length).toBe(filtered.queries.length)
    expect(all.queries.length).toBe(3)
  })
})

// ---- calendar --------------------------------------------------------------

describe('calendar', () => {
  it('is empty for a month with no entries', async () => {
    expect(await calendar(db, 1900, 1)).toEqual({ year: 1900, month: 1, days: [], total: 0 })
  })

  it('counts entries per day', async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2026-05-26' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2026-05-26' })
    await seed({ scripture_ref: 'John 1:3', entry_date: '2026-05-20' })
    const body = await calendar(db, 2026, 5)
    expect(body.total).toBe(3)
    const days = Object.fromEntries(body.days.map((d) => [d.entry_date, d.count]))
    expect(days).toEqual({ '2026-05-20': 1, '2026-05-26': 2 })
  })
})

// ---- on-this-day -----------------------------------------------------------

describe('onThisDay', () => {
  it('is empty with no prior-year entries', async () => {
    expect((await onThisDay(db, '2026-05-26', 10)).entries).toEqual([])
  })

  it('returns prior-year matches newest-first, excluding the target year', async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2024-05-26' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2025-05-26' })
    await seed({ scripture_ref: 'John 1:3', entry_date: '2026-05-26' }) // target year — excluded
    await seed({ scripture_ref: 'John 1:4', entry_date: '2025-05-27' }) // different day
    const body = await onThisDay(db, '2026-05-26', 10)
    expect(body.target_date).toBe('2026-05-26')
    expect(body.entries.map((e) => e.entry_date)).toEqual(['2025-05-26', '2024-05-26'])
  })

  it('years_back bounds how far back it looks', async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2024-05-26' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2010-05-26' })
    const body = await onThisDay(db, '2026-05-26', 5)
    expect(body.entries.map((e) => e.entry_date)).toEqual(['2024-05-26'])
  })

  it('Feb 29 target matches prior leap-year Feb 29, not Feb 28', async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2024-02-29' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2020-02-29' })
    await seed({ scripture_ref: 'John 1:3', entry_date: '2025-02-28' })
    const body = await onThisDay(db, '2028-02-29', 10)
    expect(body.entries.map((e) => e.entry_date)).toEqual(['2024-02-29', '2020-02-29'])
  })

  it('Feb 28 non-leap target does not pull Feb 29', async () => {
    await seed({ scripture_ref: 'John 1:1', entry_date: '2024-02-29' })
    await seed({ scripture_ref: 'John 1:2', entry_date: '2025-02-28' })
    const body = await onThisDay(db, '2026-02-28', 10)
    expect(body.entries.map((e) => e.entry_date)).toEqual(['2025-02-28'])
  })
})

// ---- passage-entries -------------------------------------------------------

describe('getPassageEntries — overlap semantics (chapter-level, Model B)', () => {
  it('an overlapping range matches', async () => {
    await seed({ scripture_ref: 'Genesis 3:14-18', title: 'Range' })
    const body = await getPassageEntries(db, 'Genesis 3:16')
    expect(body.count).toBe(1)
    expect(body.entries[0].title).toBe('Range')
  })

  it('a whole-chapter entry matches a specific-verse query', async () => {
    await seed({ scripture_ref: 'Genesis 3', title: 'Whole chapter' })
    const body = await getPassageEntries(db, 'Genesis 3:16')
    expect(body.count).toBe(1)
    expect(body.entries[0].title).toBe('Whole chapter')
  })

  it('a different chapter does not match', async () => {
    await seed({ scripture_ref: 'Genesis 2:1', title: 'Different chapter' })
    const body = await getPassageEntries(db, 'Genesis 3:16')
    expect(body.count).toBe(0)
    expect(body.entries).toEqual([])
  })

  it('a whole-chapter query returns all overlapping entries', async () => {
    await seed({ scripture_ref: 'Genesis 3:1', title: 'One' })
    await seed({ scripture_ref: 'Genesis 3:17-20', title: 'Two' })
    await seed({ scripture_ref: 'Genesis 2:1', title: 'Other chapter' })
    const body = await getPassageEntries(db, 'Genesis 3')
    expect(body.entries.map((e) => e.title).sort()).toEqual(['One', 'Two'])
    expect(body.count).toBe(2)
  })

  it('no matching entries returns empty', async () => {
    await seed({ scripture_ref: 'Romans 1:1', title: 'Far away' })
    const body = await getPassageEntries(db, 'Genesis 3:16')
    expect(body.count).toBe(0)
  })

  it('echoes the resolved reference', async () => {
    await seed({ scripture_ref: 'Genesis 3:16' })
    const body = await getPassageEntries(db, 'Genesis 3:16', 'TST')
    expect(body.reference.canonical_string).toBe('Genesis 3:16')
    expect(body.reference.translation_code).toBe('TST')
    expect(body.reference.book.name).toBe('Genesis')
    expect(body.reference.chapter_number).toBe(3)
  })
})

describe('getPassageEntries — reference errors', () => {
  it('bad reference -> INVALID_REFERENCE (400)', async () => {
    await expect(getPassageEntries(db, 'Frodo 3:16')).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
    })
  })

  it('out of range -> REFERENCE_OUT_OF_RANGE (404)', async () => {
    await expect(getPassageEntries(db, 'Genesis 3:99')).rejects.toMatchObject({
      code: 'REFERENCE_OUT_OF_RANGE',
      status: 404,
    })
  })

  it('unknown translation -> TRANSLATION_NOT_FOUND (404)', async () => {
    await expect(getPassageEntries(db, 'Genesis 3:16', 'NOPE')).rejects.toMatchObject({
      code: 'TRANSLATION_NOT_FOUND',
      status: 404,
    })
  })
})

describe('getPassageEntries — Model B translation-agnostic matching', () => {
  it('surfaces an entry journaled in another translation', async () => {
    // TST is first-loaded; load a second translation ALT.
    await loadTranslation(db, buildTranslation('ALT'), '2026-07-01T00:00:00.000Z')
    // Entry resolves under the default (first-loaded) translation, TST.
    await seed({ scripture_ref: 'Genesis 3:16', title: 'Journaled in TST' })

    // Reading the same passage in ALT still surfaces it (coordinate match).
    const body = await getPassageEntries(db, 'Genesis 3', 'ALT')
    expect(body.count).toBe(1)
    expect(body.entries[0].title).toBe('Journaled in TST')
    expect(body.reference.translation_code).toBe('ALT')
  })
})
