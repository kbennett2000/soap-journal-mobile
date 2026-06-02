// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema, type CanonicalTranslation } from '@/lib/schema/canonical'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import type { DbExecutor } from './executor'
import { loadTranslation } from './loadTranslation'
import { runMigrations } from './migrations'

// Re-expression of the server's load_translation_test.py against
// BetterSqliteExecutor + migration v1. The oracle's CLI/validation tests
// (missing file, invalid JSON, empty-books ValidationError) are out of scope:
// file/CLI handling is the build-script cycle, and payload validation is
// covered by canonical.test.ts. This cycle is insert correctness only.

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
})

afterEach(async () => {
  await db.close()
})

// ---- fixtures (mirror the oracle's _book / _full_translation) --------------

function book(index: number, verseCount = 1, chapterCount = 1): unknown {
  const spec = ALL_BOOKS[index - 1]
  return {
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: Array.from({ length: chapterCount }, (_, c) => ({
      number: c + 1,
      verses: Array.from({ length: verseCount }, (_, v) => ({
        number: v + 1,
        text: `${spec.name} ${c + 1}:${v + 1}`,
      })),
    })),
  }
}

// Builds plain objects then validates through the schema, producing a typed,
// defaults-filled CanonicalTranslation — the same validate-then-load pipeline
// real callers use.
function fullTranslation({
  code = 'TST',
  name = 'Test Translation',
  enrichGenesis = false,
}: { code?: string; name?: string; enrichGenesis?: boolean } = {}): CanonicalTranslation {
  const books = Array.from({ length: 66 }, (_, i) => book(i + 1))
  if (enrichGenesis) {
    // Genesis 1: 5 verses with a heading + a footnote so we can verify those load too.
    books[0] = {
      name: ALL_BOOKS[0].name,
      abbreviation: ALL_BOOKS[0].abbreviation,
      order_index: ALL_BOOKS[0].order_index,
      chapters: [
        {
          number: 1,
          verses: Array.from({ length: 5 }, (_, v) => ({ number: v + 1, text: `Gen 1:${v + 1}` })),
          headings: [{ before_verse: 1, text: 'The Creation' }],
          footnotes: [{ verse_number: 2, text: 'Heb. tohu wabohu' }],
        },
      ],
    }
  }
  return CanonicalTranslationSchema.parse({
    code,
    name,
    language: 'en',
    copyright: '© test fixture',
    books,
  })
}

async function count(table: string, where = '', params: unknown[] = []): Promise<number> {
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT count(*) n FROM ${table} ${where}`,
    params,
  )
  return n
}

// ---- core loader -----------------------------------------------------------

describe('loadTranslation — insert', () => {
  it('inserts translation, books, chapters, verses (+ heading & footnote)', async () => {
    const counts = await loadTranslation(db, fullTranslation({ enrichGenesis: true }))

    // 65 other books contribute 1 verse each; Genesis 1 has 5.
    expect(counts).toEqual({ books: 66, chapters: 66, verses: 70 })

    const [translation] = await db.query<{ id: number; name: string; language: string }>(
      'SELECT id, name, language FROM translations WHERE code = ?',
      ['TST'],
    )
    expect(translation.name).toBe('Test Translation')
    expect(translation.language).toBe('en')

    expect(await count('books', 'WHERE translation_id = ?', [translation.id])).toBe(66)

    // Spot-check Genesis 1:2 — enriched above.
    const [{ text }] = await db.query<{ text: string }>(
      `SELECT v.text FROM verses v
         JOIN chapters c ON c.id = v.chapter_id
         JOIN books b ON b.id = c.book_id
        WHERE b.translation_id = ? AND b.name = 'Genesis' AND c.number = 1 AND v.number = 2`,
      [translation.id],
    )
    expect(text).toBe('Gen 1:2')

    // Heading + footnote loaded; footnote resolved to the verse-2 row.
    const [{ headingText }] = await db.query<{ headingText: string }>(
      `SELECT h.text headingText FROM headings h
         JOIN chapters c ON c.id = h.chapter_id
         JOIN books b ON b.id = c.book_id
        WHERE b.name = 'Genesis' AND c.number = 1 AND h.before_verse = 1`,
    )
    expect(headingText).toBe('The Creation')

    const [{ footnoteText, verseNumber }] = await db.query<{
      footnoteText: string
      verseNumber: number
    }>(
      `SELECT f.text footnoteText, v.number verseNumber FROM footnotes f
         JOIN verses v ON v.id = f.verse_id
         JOIN chapters c ON c.id = v.chapter_id
         JOIN books b ON b.id = c.book_id
        WHERE b.name = 'Genesis' AND c.number = 1`,
    )
    expect(footnoteText).toBe('Heb. tohu wabohu')
    expect(verseNumber).toBe(2)
  })
})

describe('loadTranslation — replace by code', () => {
  it('reloading the same code replaces cleanly (no doubling)', async () => {
    await loadTranslation(db, fullTranslation({ code: 'TST', name: 'First name' }))
    await loadTranslation(db, fullTranslation({ code: 'TST', name: 'Renamed' }))

    expect(await count('translations', 'WHERE code = ?', ['TST'])).toBe(1)
    const [{ name }] = await db.query<{ name: string }>(
      'SELECT name FROM translations WHERE code = ?',
      ['TST'],
    )
    expect(name).toBe('Renamed')

    expect(await count('books')).toBe(66)
    expect(await count('chapters')).toBe(66)
    expect(await count('verses')).toBe(66)
  })

  it('cascades dependents away on replace (headings & footnotes cleared)', async () => {
    await loadTranslation(db, fullTranslation({ code: 'TST', enrichGenesis: true }))
    expect(await count('headings')).toBe(1)
    expect(await count('footnotes')).toBe(1)

    // Reload the same code without enrichment — old dependents must cascade out.
    await loadTranslation(db, fullTranslation({ code: 'TST', enrichGenesis: false }))
    expect(await count('headings')).toBe(0)
    expect(await count('footnotes')).toBe(0)
    expect(await count('verses')).toBe(66)
  })
})

describe('loadTranslation — isolation between translations', () => {
  it('a second translation does not disturb the first', async () => {
    await loadTranslation(db, fullTranslation({ code: 'AAA', name: 'Alpha' }))
    await loadTranslation(db, fullTranslation({ code: 'BBB', name: 'Beta' }))

    const codes = (await db.query<{ code: string }>('SELECT code FROM translations ORDER BY code'))
      .map((r) => r.code)
    expect(codes).toEqual(['AAA', 'BBB'])
    expect(await count('books')).toBe(132)

    // Reloading AAA leaves BBB intact.
    await loadTranslation(db, fullTranslation({ code: 'AAA', name: 'Alpha renamed' }))
    const [bbb] = await db.query<{ id: number }>('SELECT id FROM translations WHERE code = ?', ['BBB'])
    expect(await count('books', 'WHERE translation_id = ?', [bbb.id])).toBe(66)
  })
})

// ---- net-new mapping coverage (beyond the server oracle) -------------------

describe('loadTranslation — column mapping', () => {
  it('maps copyright -> copyright_notice and stores the injected loaded_at', async () => {
    await loadTranslation(db, fullTranslation({ code: 'MAP' }), '2026-06-02T12:00:00.000Z')
    const [row] = await db.query<{ copyright_notice: string; loaded_at: string }>(
      'SELECT copyright_notice, loaded_at FROM translations WHERE code = ?',
      ['MAP'],
    )
    expect(row.copyright_notice).toBe('© test fixture')
    expect(row.loaded_at).toBe('2026-06-02T12:00:00.000Z')
  })

  it('persists is_red_letter as 0/1', async () => {
    const payload = CanonicalTranslationSchema.parse({
      code: 'RL',
      name: 'Red Letter',
      language: 'en',
      copyright: 'x',
      books: Array.from({ length: 66 }, (_, i) => {
        if (i === 39) {
          // Matthew (order_index 40): one red-letter verse.
          const spec = ALL_BOOKS[39]
          return {
            name: spec.name,
            abbreviation: spec.abbreviation,
            order_index: spec.order_index,
            chapters: [
              {
                number: 1,
                verses: [{ number: 1, text: 'words of Christ', is_red_letter: true }],
              },
            ],
          }
        }
        return book(i + 1)
      }),
    })
    await loadTranslation(db, payload)

    const [{ is_red_letter }] = await db.query<{ is_red_letter: number }>(
      `SELECT v.is_red_letter FROM verses v
         JOIN chapters c ON c.id = v.chapter_id
         JOIN books b ON b.id = c.book_id
        WHERE b.name = 'Matthew'`,
    )
    expect(is_red_letter).toBe(1)
  })
})
