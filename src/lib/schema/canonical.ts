/**
 * Canonical JSON schema for Bible text.
 *
 * Every parser targets this format. The loader (`lib/db/loadTranslation`) and
 * the build-time `build-bible-db` script consume it; the reader reads only
 * canonical-format data from the DB. Adding a new translation = produce a
 * canonical JSON that validates against this schema.
 *
 * This is the TS half of a contract whose other half is the server's
 * `parsers/schema.py` (Pydantic). The two are kept in lockstep — a file that
 * validates on the server imports cleanly on the phone, and vice versa. This
 * module is a 1:1 port of that file; `schema_test.py` is the oracle.
 *
 * Pure module: it validates structure only. It does not touch the database,
 * and it does not map errors to the import UX (that happens at the call site).
 */

import { z } from 'zod'

import { ALL_BOOKS, getBookByName } from '@/lib/bible/books'

/** True when `numbers` is exactly [1, 2, …, N] (no gaps, no duplicates, in order). */
function isOneToN(numbers: number[]): boolean {
  return numbers.every((n, i) => n === i + 1)
}

export const CanonicalVerseSchema = z
  .object({
    number: z.number().int().min(1),
    text: z.string().min(1),
    is_red_letter: z.boolean().default(false),
  })
  .strict()

export const CanonicalHeadingSchema = z
  .object({
    before_verse: z.number().int().min(1),
    text: z.string().min(1),
  })
  .strict()

export const CanonicalFootnoteSchema = z
  .object({
    verse_number: z.number().int().min(1),
    text: z.string().min(1),
  })
  .strict()

export const CanonicalChapterSchema = z
  .object({
    number: z.number().int().min(1),
    verses: z.array(CanonicalVerseSchema).min(1),
    headings: z.array(CanonicalHeadingSchema).default([]),
    footnotes: z.array(CanonicalFootnoteSchema).default([]),
  })
  .strict()
  .superRefine((chapter, ctx) => {
    const numbers = chapter.verses.map((v) => v.number)
    if (!isOneToN(numbers)) {
      ctx.addIssue({
        code: 'custom',
        message: `chapter ${chapter.number} verses must be numbered 1..N with no gaps or duplicates, got ${JSON.stringify(numbers)}`,
      })
      return
    }

    const verseNumbers = new Set(numbers)
    for (const heading of chapter.headings) {
      if (!verseNumbers.has(heading.before_verse)) {
        ctx.addIssue({
          code: 'custom',
          message: `chapter ${chapter.number} heading before_verse=${heading.before_verse} does not match any verse`,
        })
        return
      }
    }
    for (const footnote of chapter.footnotes) {
      if (!verseNumbers.has(footnote.verse_number)) {
        ctx.addIssue({
          code: 'custom',
          message: `chapter ${chapter.number} footnote verse_number=${footnote.verse_number} does not match any verse`,
        })
        return
      }
    }
  })

export const CanonicalBookSchema = z
  .object({
    name: z.string(),
    abbreviation: z.string(),
    order_index: z.number().int().min(1).max(66),
    chapters: z.array(CanonicalChapterSchema).min(1),
  })
  .strict()
  .superRefine((book, ctx) => {
    const canon = getBookByName(book.name)
    if (canon === undefined || canon.name !== book.name) {
      ctx.addIssue({
        code: 'custom',
        message: `book '${book.name}' is not the canonical form; use the exact name from ALL_BOOKS`,
      })
      return
    }
    if (canon.order_index !== book.order_index) {
      ctx.addIssue({
        code: 'custom',
        message: `book '${book.name}' expects order_index=${canon.order_index}, got ${book.order_index}`,
      })
      return
    }
    if (canon.abbreviation !== book.abbreviation) {
      ctx.addIssue({
        code: 'custom',
        message: `book '${book.name}' expects abbreviation='${canon.abbreviation}', got '${book.abbreviation}'`,
      })
      return
    }

    const numbers = book.chapters.map((c) => c.number)
    if (!isOneToN(numbers)) {
      ctx.addIssue({
        code: 'custom',
        message: `book '${book.name}' chapters must be numbered 1..N with no gaps or duplicates, got ${JSON.stringify(numbers)}`,
      })
    }
  })

export const CanonicalTranslationSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    language: z.string().min(2).max(8),
    copyright: z.string().min(1),
    books: z.array(CanonicalBookSchema),
  })
  .strict()
  .superRefine((translation, ctx) => {
    const expected = ALL_BOOKS.map((b) => [b.order_index, b.name] as const)
    const actual = translation.books.map((b) => [b.order_index, b.name] as const)

    const shared = Math.min(expected.length, actual.length)
    for (let i = 0; i < shared; i++) {
      const [wantIndex, wantName] = expected[i]
      const [gotIndex, gotName] = actual[i]
      if (wantIndex !== gotIndex || wantName !== gotName) {
        ctx.addIssue({
          code: 'custom',
          message: `books[${i}] expected (order_index=${wantIndex}, name='${wantName}'), got (order_index=${gotIndex}, name='${gotName}')`,
        })
        return
      }
    }

    if (actual.length !== expected.length) {
      ctx.addIssue({
        code: 'custom',
        message: `translation must have exactly ${expected.length} books, got ${actual.length}`,
      })
    }
  })

export type CanonicalVerse = z.infer<typeof CanonicalVerseSchema>
export type CanonicalHeading = z.infer<typeof CanonicalHeadingSchema>
export type CanonicalFootnote = z.infer<typeof CanonicalFootnoteSchema>
export type CanonicalChapter = z.infer<typeof CanonicalChapterSchema>
export type CanonicalBook = z.infer<typeof CanonicalBookSchema>
export type CanonicalTranslation = z.infer<typeof CanonicalTranslationSchema>

export type CanonicalValidationResult =
  | { success: true; data: CanonicalTranslation }
  | { success: false; errors: string[] }

/**
 * Validate an already-parsed JSON value against the canonical translation
 * schema. Returns the typed data on success, or a list of readable error
 * strings on failure. Pure: the caller does `JSON.parse` and maps errors to
 * UX; this function does neither.
 */
export function validateCanonicalTranslation(input: unknown): CanonicalValidationResult {
  const result = CanonicalTranslationSchema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return { success: false, errors }
}
