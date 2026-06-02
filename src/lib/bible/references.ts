/**
 * Verse reference parser.
 *
 * Turns user-typed strings like "John 3:16-20" into a structured, validated
 * `ParsedReference`. The single source of truth for what reference syntax the
 * app accepts — the jump bar and any future caller should funnel through
 * `parseReferenceOrRaise`.
 *
 * This module does not touch the database. It validates structure against the
 * static book list in `@/lib/bible/books`. Whether the chapter/verse range
 * actually exists in a loaded translation is the repository layer's job (it
 * has the DB connection).
 *
 * Accepted syntax (v1)
 * --------------------
 * - "John 3:16"        single verse
 * - "John 3:16-20"     verse range within one chapter
 * - "John 3"           whole chapter (no verse component)
 * - Abbreviations / aliases: "Jn 3:16", "1Cor 13", "Apocalypse 22:21"
 * - Case-insensitive, whitespace-tolerant, en/em dash as range separator,
 *   no-space numbered books ("1John 3:16").
 *
 * Rejected (v1)
 * -------------
 * - Empty input, book name alone, unknown book.
 * - Cross-chapter ranges ("John 3:30-4:2"). Documented as a v2 deferral.
 * - Multiple references separated by ";" or ",". One reference per call.
 * - Reversed range, non-positive numbers, partial garbage.
 *
 * Ported 1:1 from the soap-journal server's `core/references.py`; that file
 * and its `references_test.py` are the source and the oracle for this module.
 */

import { type Book, getBookByName } from '@/lib/bible/books'

/**
 * Raised when the input string cannot be turned into a ParsedReference.
 *
 * The repository layer maps this to 400 INVALID_REFERENCE and surfaces the
 * message as the user-facing text.
 */
export class ReferenceParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceParseError'
  }
}

export interface ParsedReference {
  readonly book: Book
  readonly chapter: number
  readonly startVerse: number | null
  readonly endVerse: number | null
  readonly canonicalString: string
}

// Normalize en/em dashes to ASCII hyphen before matching so the regex only
// has to think about one separator. (en, em, minus sign)
const DASH_CHARS = ['–', '—', '−']

// Single regex with named groups. Book is constrained to "[optional 1-3
// numbered prefix] + alphabetic word(s)" so backtracking can't smuggle digits
// or dashes into the book name (which would turn "John 3:30-4:2" into a fake
// book like "John 3:30-"). Verse / range are optional. This is the inlined
// equivalent of the server's re.VERBOSE pattern.
const REF_RE =
  /^(?<book>(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(?<chapter>\d+)(?:\s*:\s*(?<startVerse>\d+)(?:\s*-\s*(?<endVerse>\d+))?)?$/

// Detects "John 3:30-4:2"-style inputs after normalization — these won't
// survive REF_RE; we want a specific error rather than the generic one.
const CROSS_CHAPTER_RE = /\d+:\d+\s*-\s*\d+:\d+/

/** Reject inputs that try to pack more than one reference per call. */
function looksLikeMultiReference(s: string): boolean {
  return s.includes(';') || s.includes(',')
}

/** Lowercase dashes, collapse whitespace runs to single spaces, strip ends. */
function normalize(raw: string): string {
  let s = raw
  for (const dash of DASH_CHARS) {
    s = s.replaceAll(dash, '-')
  }
  // Collapse any whitespace run to a single space; the regex tolerates a
  // single optional space at each boundary.
  return s.replace(/\s+/g, ' ').trim()
}

function buildCanonicalString(
  book: Book,
  chapter: number,
  start: number | null,
  end: number | null,
): string {
  if (start === null) {
    return `${book.name} ${chapter}`
  }
  if (end === null || end === start) {
    return `${book.name} ${chapter}:${start}`
  }
  return `${book.name} ${chapter}:${start}-${end}`
}

/** Parse a user-typed reference string. Throws `ReferenceParseError` on failure. */
export function parseReference(raw: string): ParsedReference {
  if (!raw || !raw.trim()) {
    throw new ReferenceParseError('reference is empty')
  }

  if (looksLikeMultiReference(raw)) {
    throw new ReferenceParseError(
      'multiple references are not supported; provide one reference per call',
    )
  }

  const s = normalize(raw)
  const match = REF_RE.exec(s)
  if (match === null) {
    // Did the user type just a known book name without a chapter? Give a
    // specific message; otherwise the input is opaque garbage.
    if (getBookByName(s) !== undefined) {
      throw new ReferenceParseError(`reference is missing a chapter number: '${raw}'`)
    }
    throw new ReferenceParseError(`could not parse reference: '${raw}'`)
  }

  const groups = match.groups!
  const bookStr = groups.book.trim()
  const chapter = parseInt(groups.chapter, 10)
  const startStr = groups.startVerse
  const endStr = groups.endVerse

  const book = getBookByName(bookStr)
  if (book === undefined) {
    throw new ReferenceParseError(`unknown book: '${bookStr}'`)
  }

  if (chapter < 1) {
    throw new ReferenceParseError(`chapter must be 1 or greater, got ${chapter}`)
  }

  if (startStr === undefined) {
    // Whole-chapter reference. There's no syntactic way to write "John 3-4"
    // today; cross-chapter ranges are deferred.
    return Object.freeze({
      book,
      chapter,
      startVerse: null,
      endVerse: null,
      canonicalString: buildCanonicalString(book, chapter, null, null),
    })
  }

  const startVerse = parseInt(startStr, 10)
  if (startVerse < 1) {
    throw new ReferenceParseError(`verse must be 1 or greater, got ${startVerse}`)
  }

  if (endStr === undefined) {
    return Object.freeze({
      book,
      chapter,
      startVerse,
      endVerse: startVerse,
      canonicalString: buildCanonicalString(book, chapter, startVerse, null),
    })
  }

  const endVerse = parseInt(endStr, 10)
  if (endVerse < 1) {
    throw new ReferenceParseError(`verse must be 1 or greater, got ${endVerse}`)
  }
  if (endVerse < startVerse) {
    throw new ReferenceParseError(
      `end verse must be >= start verse, got ${startVerse}-${endVerse}`,
    )
  }

  return Object.freeze({
    book,
    chapter,
    startVerse,
    endVerse,
    canonicalString: buildCanonicalString(book, chapter, startVerse, endVerse),
  })
}

/** Detect "John 3:30-4:2"-style inputs after normalization. */
function isCrossChapterAttempt(raw: string): boolean {
  return CROSS_CHAPTER_RE.test(normalize(raw))
}

/**
 * Same as `parseReference` but with the cross-chapter case promoted to a
 * dedicated error message so callers surface "not supported" instead of
 * "could not parse". This is the function the repository layer should call.
 */
export function parseReferenceOrRaise(raw: string): ParsedReference {
  if (isCrossChapterAttempt(raw)) {
    throw new ReferenceParseError(
      "cross-chapter ranges are not supported in v1; use a single chapter (e.g. 'John 3:30-36')",
    )
  }
  return parseReference(raw)
}
