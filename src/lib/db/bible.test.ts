// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema, type CanonicalTranslation } from '@/lib/schema/canonical'

import { getChapter, getTranslationDetail, listTranslations, resolveReference } from './bible'
import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { ApiError } from './errors'
import type { DbExecutor, RunResult } from './executor'
import { loadTranslation } from './loadTranslation'
import { runMigrations } from './migrations'

// Re-expression of api/bible_test.py against BetterSqliteExecutor + a synthetic
// translation. Auth/401 tests are dropped (single-user, no auth). The server
// asserts real BSB counts (John 36 verses, etc.); we assert our fixture's known
// structure. ApiError.code/.status stands in for the server's HTTP status +
// detail.code.

// ---- fixture ---------------------------------------------------------------

type Verse = { number: number; text: string; is_red_letter?: boolean }
type Chapter = { number: number; verses: Verse[]; headings?: unknown[]; footnotes?: unknown[] }

function verses(count: number, label: string): Verse[] {
  return Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${label} ${i + 1}` }))
}

// Per-book chapter overrides; everything else gets one chapter, one verse.
const OVERRIDES: Record<string, Chapter[]> = {
  Genesis: [
    {
      number: 1,
      verses: [
        { number: 1, text: 'Gen 1:1' },
        { number: 2, text: 'Gen 1:2' },
        { number: 3, text: 'Gen 1:3', is_red_letter: true },
        { number: 4, text: 'Gen 1:4' },
        { number: 5, text: 'Gen 1:5' },
      ],
      headings: [{ before_verse: 1, text: 'The Beginning' }],
      footnotes: [{ verse_number: 2, text: 'a footnote on verse 2' }],
    },
    { number: 2, verses: verses(3, 'Gen 2') },
  ],
  // Psalms gets 4 chapters with a "middle" 5-verse and 30-verse chapter for the
  // no-N+1 getChapter invariant (same nav shape, different verse counts).
  Psalms: [
    { number: 1, verses: verses(3, 'Ps 1') },
    { number: 2, verses: verses(5, 'Ps 2') },
    { number: 3, verses: verses(30, 'Ps 3') },
    { number: 4, verses: verses(3, 'Ps 4') },
  ],
}

function buildTranslation(code: string, name = code): CanonicalTranslation {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: OVERRIDES[spec.name] ?? [{ number: 1, verses: verses(1, spec.name) }],
  }))
  return CanonicalTranslationSchema.parse({
    code,
    name,
    language: 'en',
    copyright: `© ${code}`,
    books,
  })
}

// Records the SQL of every query() call to prove the no-N+1 discipline.
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

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
})

afterEach(async () => {
  await db.close()
})

// ---- list ------------------------------------------------------------------

describe('listTranslations', () => {
  it('maps code/name/language/copyright', async () => {
    await loadTranslation(db, buildTranslation('AAA', 'Alpha'))
    const { translations } = await listTranslations(db)
    expect(translations).toEqual([
      { code: 'AAA', name: 'Alpha', language: 'en', copyright: '© AAA' },
    ])
  })

  it('is empty when nothing is loaded', async () => {
    expect(await listTranslations(db)).toEqual({ translations: [] })
  })

  it('orders by load order', async () => {
    await loadTranslation(db, buildTranslation('AAA'), '2026-01-01T00:00:00.000Z')
    await loadTranslation(db, buildTranslation('BBB'), '2026-02-01T00:00:00.000Z')
    const codes = (await listTranslations(db)).translations.map((t) => t.code)
    expect(codes).toEqual(['AAA', 'BBB'])
  })
})

// ---- translation detail ----------------------------------------------------

describe('getTranslationDetail', () => {
  beforeEach(async () => {
    await loadTranslation(db, buildTranslation('AAA'))
  })

  it('returns 66 books in canonical order', async () => {
    const { books } = await getTranslationDetail(db, 'AAA')
    expect(books.length).toBe(66)
    expect(books.map((b) => b.order_index)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1))
    expect(books[0].name).toBe('Genesis')
    expect(books[65].name).toBe('Revelation')
  })

  it('reports chapter counts', async () => {
    const { books } = await getTranslationDetail(db, 'AAA')
    const byName = Object.fromEntries(books.map((b) => [b.name, b.chapter_count]))
    expect(byName.Genesis).toBe(2)
    expect(byName.Psalms).toBe(4)
    expect(byName.Exodus).toBe(1)
    expect(byName.Revelation).toBe(1)
  })

  it('splits testaments 39 / 27', async () => {
    const { books } = await getTranslationDetail(db, 'AAA')
    expect(books.filter((b) => b.testament === 'OT').length).toBe(39)
    expect(books.filter((b) => b.testament === 'NT').length).toBe(27)
  })

  it('throws TRANSLATION_NOT_FOUND for an unknown code', async () => {
    await expect(getTranslationDetail(db, 'NOPE')).rejects.toMatchObject({
      code: 'TRANSLATION_NOT_FOUND',
      status: 404,
    })
  })

  it('uses a single grouped chapter-count query (no N+1)', async () => {
    const counting = new CountingExecutor(db)
    await getTranslationDetail(counting, 'AAA')
    const chapterQueries = counting.queries.filter((q) => /chapters/i.test(q))
    expect(chapterQueries.length).toBe(1)
  })
})

// ---- chapter ---------------------------------------------------------------

describe('getChapter', () => {
  beforeEach(async () => {
    await loadTranslation(db, buildTranslation('AAA'))
  })

  it('returns verses, headings, footnotes and red-letter flag', async () => {
    const chapter = await getChapter(db, 'AAA', 'Genesis', 1)
    expect(chapter.chapter_number).toBe(1)
    expect(chapter.book.name).toBe('Genesis')
    expect(chapter.verses.map((v) => v.number)).toEqual([1, 2, 3, 4, 5])
    expect(chapter.headings).toEqual([{ before_verse: 1, text: 'The Beginning' }])

    const verse2 = chapter.verses.find((v) => v.number === 2)!
    expect(verse2.footnotes.map((f) => f.text)).toEqual(['a footnote on verse 2'])

    const verse3 = chapter.verses.find((v) => v.number === 3)!
    expect(verse3.is_red_letter).toBe(true)
    expect(chapter.verses.find((v) => v.number === 1)!.is_red_letter).toBe(false)
  })

  it('resolves the book by abbreviation', async () => {
    expect((await getChapter(db, 'AAA', 'Gn', 1)).book.name).toBe('Genesis')
  })

  it('resolves the book by alias', async () => {
    expect((await getChapter(db, 'AAA', 'Apocalypse', 1)).book.name).toBe('Revelation')
  })

  it('navigates within a book', async () => {
    const ch = await getChapter(db, 'AAA', 'Genesis', 1)
    expect(ch.previous).toBeNull()
    expect(ch.next).toEqual({ book_name: 'Genesis', chapter_number: 2 })
  })

  it('navigates across a book boundary forward', async () => {
    const ch = await getChapter(db, 'AAA', 'Genesis', 2) // Genesis' last chapter
    expect(ch.next).toEqual({ book_name: 'Exodus', chapter_number: 1 })
  })

  it('navigates across a book boundary backward', async () => {
    const ch = await getChapter(db, 'AAA', 'Exodus', 1)
    expect(ch.previous).toEqual({ book_name: 'Genesis', chapter_number: 2 })
  })

  it('first chapter of the first book has null previous', async () => {
    const ch = await getChapter(db, 'AAA', 'Genesis', 1)
    expect(ch.previous).toBeNull()
  })

  it('last chapter of the last book has null next', async () => {
    const ch = await getChapter(db, 'AAA', 'Revelation', 1)
    expect(ch.next).toBeNull()
    expect(ch.previous).toEqual({ book_name: 'Jude', chapter_number: 1 })
  })

  it('chapter 0 -> CHAPTER_NOT_FOUND', async () => {
    await expect(getChapter(db, 'AAA', 'Genesis', 0)).rejects.toMatchObject({
      code: 'CHAPTER_NOT_FOUND',
      status: 404,
    })
  })

  it('unknown translation -> TRANSLATION_NOT_FOUND', async () => {
    await expect(getChapter(db, 'NOPE', 'Genesis', 1)).rejects.toMatchObject({
      code: 'TRANSLATION_NOT_FOUND',
    })
  })

  it('unknown book -> BOOK_NOT_FOUND', async () => {
    await expect(getChapter(db, 'AAA', 'Frodo', 1)).rejects.toMatchObject({
      code: 'BOOK_NOT_FOUND',
      status: 404,
    })
  })

  it('chapter past the end -> CHAPTER_NOT_FOUND', async () => {
    await expect(getChapter(db, 'AAA', 'Genesis', 99)).rejects.toMatchObject({
      code: 'CHAPTER_NOT_FOUND',
    })
  })

  it('issues the same number of queries regardless of verse count (no N+1)', async () => {
    // Psalms 2 (5 verses) and Psalms 3 (30 verses) are both middle chapters —
    // identical nav branches — so only the verse count differs.
    const a = new CountingExecutor(db)
    await getChapter(a, 'AAA', 'Psalms', 2)
    const b = new CountingExecutor(db)
    await getChapter(b, 'AAA', 'Psalms', 3)
    expect(b.queries.length).toBe(a.queries.length)
  })
})

// ---- resolve ---------------------------------------------------------------

describe('resolveReference', () => {
  beforeEach(async () => {
    await loadTranslation(db, buildTranslation('AAA'))
  })

  it('resolves a single verse', async () => {
    const res = await resolveReference(db, 'Genesis 1:2', 'AAA')
    expect(res.reference.canonical_string).toBe('Genesis 1:2')
    expect(res.reference.translation_code).toBe('AAA')
    expect(res.reference.start_verse).toBe(2)
    expect(res.reference.end_verse).toBe(2)
    expect(res.verses.map((v) => v.number)).toEqual([2])
    expect(res.verses[0].text).toBe('Gen 1:2')
  })

  it('resolves a verse range', async () => {
    const res = await resolveReference(db, 'Genesis 1:2-4', 'AAA')
    expect(res.reference.canonical_string).toBe('Genesis 1:2-4')
    expect(res.verses.map((v) => v.number)).toEqual([2, 3, 4])
  })

  it('resolves a whole chapter, filling start and end', async () => {
    const res = await resolveReference(db, 'Genesis 1', 'AAA')
    expect(res.reference.start_verse).toBe(1)
    expect(res.reference.end_verse).toBe(5)
    expect(res.verses.length).toBe(5)
  })

  it('normalizes an alias/case to canonical', async () => {
    expect((await resolveReference(db, 'gen 1:2', 'AAA')).reference.canonical_string).toBe(
      'Genesis 1:2',
    )
  })

  it('handles a no-space numbered book', async () => {
    expect((await resolveReference(db, '1Cor 1', 'AAA')).reference.canonical_string).toBe(
      '1 Corinthians 1',
    )
  })

  it('accepts an en dash', async () => {
    expect((await resolveReference(db, 'Genesis 1:2–4', 'AAA')).reference.canonical_string).toBe(
      'Genesis 1:2-4',
    )
  })

  it('verse out of range -> REFERENCE_OUT_OF_RANGE (message has the length)', async () => {
    await expect(resolveReference(db, 'Genesis 1:99', 'AAA')).rejects.toMatchObject({
      code: 'REFERENCE_OUT_OF_RANGE',
      status: 404,
    })
    await expect(resolveReference(db, 'Genesis 1:99', 'AAA')).rejects.toThrow('5')
  })

  it('chapter out of range -> CHAPTER_NOT_FOUND', async () => {
    await expect(resolveReference(db, 'Genesis 99', 'AAA')).rejects.toMatchObject({
      code: 'CHAPTER_NOT_FOUND',
    })
  })

  it('unknown book -> INVALID_REFERENCE (400)', async () => {
    await expect(resolveReference(db, 'Frodo 3:16', 'AAA')).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
    })
  })

  it('cross-chapter range -> INVALID_REFERENCE with the specific message', async () => {
    await expect(resolveReference(db, 'Genesis 1:2-2:3', 'AAA')).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      status: 400,
    })
    await expect(resolveReference(db, 'Genesis 1:2-2:3', 'AAA')).rejects.toThrow('cross-chapter')
  })

  it('defaults to the first-loaded translation', async () => {
    await loadTranslation(db, buildTranslation('AAA'), '2026-01-01T00:00:00.000Z')
    await loadTranslation(db, buildTranslation('BBB'), '2026-02-01T00:00:00.000Z')
    expect((await resolveReference(db, 'Genesis 1:1')).reference.translation_code).toBe('AAA')
  })

  it('unknown translation code -> TRANSLATION_NOT_FOUND', async () => {
    await expect(resolveReference(db, 'Genesis 1:1', 'NOPE')).rejects.toMatchObject({
      code: 'TRANSLATION_NOT_FOUND',
    })
  })

  it('no translations loaded -> TRANSLATION_NOT_FOUND', async () => {
    const fresh = createBetterSqliteExecutor(':memory:')
    await runMigrations(fresh)
    try {
      await expect(resolveReference(fresh, 'Genesis 1:1')).rejects.toMatchObject({
        code: 'TRANSLATION_NOT_FOUND',
      })
    } finally {
      await fresh.close()
    }
  })

  it('throws ApiError instances', async () => {
    await expect(resolveReference(db, 'Frodo 3:16', 'AAA')).rejects.toBeInstanceOf(ApiError)
  })
})

// ---- N3: rich footnotes + cross-references (read path) ----------------------

const JOHN_ABBR = ALL_BOOKS.find((b) => b.order_index === 43)!.abbreviation
const PSALMS_ABBR = ALL_BOOKS.find((b) => b.order_index === 19)!.abbreviation

/**
 * A translation whose Genesis 1:3 carries TWO footnotes (to exercise ordinal
 * ordering): an `sn` note at ordinal 1, and a `tn` note at ordinal 0 that is
 * char-anchored, ordered, marked, and carries two cross-refs (a single verse to
 * John, a range to Psalms). The `tn` note must read out FIRST (ordinal 0).
 */
function buildEnriched(code = 'NETT'): CanonicalTranslation {
  const books = ALL_BOOKS.map((spec) => {
    if (spec.order_index === 1) {
      return {
        name: spec.name,
        abbreviation: spec.abbreviation,
        order_index: spec.order_index,
        chapters: [
          {
            number: 1,
            verses: [1, 2, 3].map((n) => ({ number: n, text: 'In the beginning God created' })),
            footnotes: [
              // Listed sn-first (ordinal 1) on purpose; the read orders by ordinal.
              { verse_number: 3, text: 'sn the second note', note_type: 'sn', ordinal: 1 },
              {
                verse_number: 3,
                text: 'tn the first note',
                note_type: 'tn',
                char_offset: 4,
                marker: 1,
                ordinal: 0,
                cross_refs: [
                  { to_book_order_index: 43, to_chapter: 1, to_verse_start: 1 },
                  { to_book_order_index: 19, to_chapter: 33, to_verse_start: 6, to_verse_end: 9 },
                ],
              },
            ],
          },
        ],
      }
    }
    return {
      name: spec.name,
      abbreviation: spec.abbreviation,
      order_index: spec.order_index,
      chapters: [{ number: 1, verses: verses(1, spec.name) }],
    }
  })
  return CanonicalTranslationSchema.parse({
    code,
    name: code,
    language: 'en',
    copyright: `© ${code}`,
    books,
  })
}

describe('versesWithFootnotes — rich footnotes & cross-references', () => {
  it('getChapter returns typed notes (in ordinal order) with resolved cross-refs', async () => {
    await loadTranslation(db, buildEnriched('NETT'))
    const chapter = await getChapter(db, 'NETT', 'Genesis', 1)
    const v3 = chapter.verses.find((v) => v.number === 3)!

    // Ordinal order: the tn note (ordinal 0) precedes the sn note (ordinal 1),
    // despite being listed second in the source.
    expect(v3.footnotes.map((f) => f.note_type)).toEqual(['tn', 'sn'])

    const tn = v3.footnotes[0]
    expect(tn).toMatchObject({
      text: 'tn the first note',
      note_type: 'tn',
      char_offset: 4,
      marker: 1,
      ordinal: 0,
    })
    // Cross-refs in cr.id order: John single verse, then the Psalms range.
    expect(tn.cross_refs).toEqual([
      { to_book: JOHN_ABBR, to_chapter: 1, to_verse_start: 1, to_verse_end: null },
      { to_book: PSALMS_ABBR, to_chapter: 33, to_verse_start: 6, to_verse_end: 9 },
    ])

    // The sn note has the rich fields defaulted and no cross-refs.
    expect(v3.footnotes[1]).toMatchObject({
      note_type: 'sn',
      char_offset: null,
      marker: null,
      ordinal: 1,
      cross_refs: [],
    })
  })

  it('resolveReference carries the same rich footnote shape (shared helper)', async () => {
    await loadTranslation(db, buildEnriched('NETT'))
    const { verses: resolved } = await resolveReference(db, 'Genesis 1:3', 'NETT')
    const note = resolved[0].footnotes[0]
    expect(note.note_type).toBe('tn')
    expect(note.cross_refs[0]).toMatchObject({ to_book: JOHN_ABBR, to_verse_end: null })
  })

  it('a plain footnote reads with null note fields, ordinal 0, no cross-refs', async () => {
    // The shared buildTranslation fixture has a plain footnote on Genesis 1:2.
    await loadTranslation(db, buildTranslation('AAA'))
    const chapter = await getChapter(db, 'AAA', 'Genesis', 1)
    const v2 = chapter.verses.find((v) => v.number === 2)!
    expect(v2.footnotes).toHaveLength(1)
    expect(v2.footnotes[0]).toMatchObject({
      text: 'a footnote on verse 2',
      note_type: null,
      char_offset: null,
      marker: null,
      ordinal: 0,
      cross_refs: [],
    })
  })

  it('uses a fixed query budget — no N+1 across verses/footnotes/cross-refs', async () => {
    await loadTranslation(db, buildEnriched('NETT'))
    const counting = new CountingExecutor(db)
    await getChapter(counting, 'NETT', 'Genesis', 1)
    const footnoteQueries = counting.queries.filter((q) => /from footnotes/i.test(q))
    const crossRefQueries = counting.queries.filter((q) => /from cross_references/i.test(q))
    expect(footnoteQueries.length).toBe(1)
    expect(crossRefQueries.length).toBe(1)
  })

  it('skips the cross-ref query entirely when a chapter has no footnotes', async () => {
    await loadTranslation(db, buildEnriched('NETT'))
    const counting = new CountingExecutor(db)
    // Exodus has the default chapter (one verse, no footnotes).
    await getChapter(counting, 'NETT', 'Exodus', 1)
    expect(counting.queries.filter((q) => /from footnotes/i.test(q)).length).toBe(1)
    expect(counting.queries.filter((q) => /from cross_references/i.test(q)).length).toBe(0)
  })
})
