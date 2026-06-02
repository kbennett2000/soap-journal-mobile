import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { ALL_BOOKS } from '@/lib/bible/books'
import {
  CanonicalBookSchema,
  CanonicalChapterSchema,
  CanonicalTranslationSchema,
  CanonicalVerseSchema,
} from '@/lib/schema/canonical'

// Re-expression of the server's `parsers/schema_test.py` (the oracle). Pydantic
// "construct = validate" becomes `Schema.parse(obj)`; `ValidationError` becomes
// a failed `safeParse`. We match the oracle's accept/reject DECISIONS (and the
// asserted message substrings) — not Pydantic's exact error strings.

// ---- helpers (mirror the oracle's _minimal_chapter / _book_for / _all_66) ----

function minimalChapter(number = 1, verseCount = 3): unknown {
  return {
    number,
    verses: Array.from({ length: verseCount }, (_, i) => ({
      number: i + 1,
      text: `v${i + 1}`,
    })),
  }
}

function bookFor(index: number, verseCount = 1, chapterCount = 1): unknown {
  const spec = ALL_BOOKS[index - 1]
  return {
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: Array.from({ length: chapterCount }, (_, c) =>
      minimalChapter(c + 1, verseCount),
    ),
  }
}

function all66BooksMinimal(): unknown[] {
  return Array.from({ length: 66 }, (_, i) => bookFor(i + 1))
}

// Asserts the input is rejected; when `substring` is given, asserts some issue
// message contains it (mirrors pytest.raises(ValidationError, match=...)).
function expectInvalid(
  schema: z.ZodType,
  input: unknown,
  substring?: string,
): void {
  const result = schema.safeParse(input)
  expect(result.success).toBe(false)
  if (!result.success && substring !== undefined) {
    const messages = result.error.issues.map((i) => i.message)
    expect(
      messages.some((m) => m.includes(substring)),
      `expected an issue containing ${JSON.stringify(substring)}, got ${JSON.stringify(messages)}`,
    ).toBe(true)
  }
}

// ---- happy path ------------------------------------------------------------

describe('canonical schema — happy path', () => {
  it('minimal translation validates', () => {
    const t = CanonicalTranslationSchema.parse({
      code: 'MIN',
      name: 'Minimal',
      language: 'en',
      copyright: '© test',
      books: all66BooksMinimal(),
    })
    expect(t.books.length).toBe(66)
  })

  it('chapter with headings and footnotes validates', () => {
    const chapter = CanonicalChapterSchema.parse({
      number: 1,
      verses: [1, 2, 3].map((n) => ({ number: n, text: `v${n}` })),
      headings: [{ before_verse: 1, text: 'Section A' }],
      footnotes: [{ verse_number: 2, text: 'see Ps 23' }],
    })
    expect(chapter.headings[0].before_verse).toBe(1)
    expect(chapter.footnotes[0].verse_number).toBe(2)
  })

  it('is_red_letter defaults to false', () => {
    const v = CanonicalVerseSchema.parse({ number: 1, text: 'In the beginning' })
    expect(v.is_red_letter).toBe(false)
  })
})

// ---- chapter-level validators ---------------------------------------------

describe('canonical schema — chapter validators', () => {
  it('verses must start at 1', () => {
    expectInvalid(
      CanonicalChapterSchema,
      { number: 1, verses: [{ number: 2, text: 'x' }, { number: 3, text: 'y' }] },
      'numbered 1..N',
    )
  })

  it('verses must have no gaps', () => {
    expectInvalid(
      CanonicalChapterSchema,
      { number: 1, verses: [{ number: 1, text: 'x' }, { number: 3, text: 'z' }] },
      'numbered 1..N',
    )
  })

  it('verses must have no duplicates', () => {
    expectInvalid(
      CanonicalChapterSchema,
      { number: 1, verses: [{ number: 1, text: 'x' }, { number: 1, text: 'x-dup' }] },
      'numbered 1..N',
    )
  })

  it('heading pointing at a nonexistent verse is rejected', () => {
    expectInvalid(
      CanonicalChapterSchema,
      {
        number: 1,
        verses: [{ number: 1, text: 'x' }],
        headings: [{ before_verse: 99, text: 'never' }],
      },
      'does not match any verse',
    )
  })

  it('footnote pointing at a nonexistent verse is rejected', () => {
    expectInvalid(
      CanonicalChapterSchema,
      {
        number: 1,
        verses: [{ number: 1, text: 'x' }],
        footnotes: [{ verse_number: 42, text: 'never' }],
      },
      'does not match any verse',
    )
  })
})

// ---- book-level validators -------------------------------------------------

describe('canonical schema — book validators', () => {
  it('non-canonical book name is rejected', () => {
    expectInvalid(
      CanonicalBookSchema,
      { name: 'Genesys', abbreviation: 'Gen', order_index: 1, chapters: [minimalChapter()] },
      'not the canonical form',
    )
  })

  it('an alias is rejected in the canonical name field', () => {
    // "Song of Songs" is an alias; the canonical name is "Song of Solomon".
    expectInvalid(
      CanonicalBookSchema,
      { name: 'Song of Songs', abbreviation: 'Song', order_index: 22, chapters: [minimalChapter()] },
      'not the canonical form',
    )
  })

  it('wrong order_index for a canonical name is rejected', () => {
    expectInvalid(
      CanonicalBookSchema,
      { name: 'Genesis', abbreviation: 'Gen', order_index: 7, chapters: [minimalChapter()] },
      'expects order_index=1',
    )
  })

  it('wrong abbreviation is rejected', () => {
    expectInvalid(
      CanonicalBookSchema,
      { name: 'Genesis', abbreviation: 'Gn', order_index: 1, chapters: [minimalChapter()] },
      'expects abbreviation',
    )
  })

  it('chapters must be numbered 1..N', () => {
    const spec = ALL_BOOKS[0]
    expectInvalid(
      CanonicalBookSchema,
      {
        name: spec.name,
        abbreviation: spec.abbreviation,
        order_index: spec.order_index,
        chapters: [minimalChapter(1), minimalChapter(3)],
      },
      'chapters must be numbered 1..N',
    )
  })

  it('a duplicate chapter is rejected', () => {
    const spec = ALL_BOOKS[0]
    expectInvalid(
      CanonicalBookSchema,
      {
        name: spec.name,
        abbreviation: spec.abbreviation,
        order_index: spec.order_index,
        chapters: [minimalChapter(1), minimalChapter(1)],
      },
      'chapters must be numbered 1..N',
    )
  })
})

// ---- translation-level validators -----------------------------------------

describe('canonical schema — translation validators', () => {
  it('a missing book is rejected', () => {
    const books = all66BooksMinimal()
    books.pop() // drop Revelation
    expectInvalid(
      CanonicalTranslationSchema,
      { code: 'X', name: 'X', language: 'en', copyright: 'x', books },
      'must have exactly 66 books',
    )
  })

  it('out-of-order books are rejected', () => {
    const books = all66BooksMinimal()
    ;[books[0], books[1]] = [books[1], books[0]] // swap Genesis and Exodus
    expectInvalid(
      CanonicalTranslationSchema,
      { code: 'X', name: 'X', language: 'en', copyright: 'x', books },
      'expected',
    )
  })
})

// ---- field / strict --------------------------------------------------------

describe('canonical schema — field constraints', () => {
  it('an unknown field is rejected (strict)', () => {
    expectInvalid(CanonicalVerseSchema, { number: 1, text: 'x', unexpected: true })
  })

  it('empty verse text is rejected', () => {
    expectInvalid(CanonicalVerseSchema, { number: 1, text: '' })
  })
})
