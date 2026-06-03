/**
 * Bible reader — read-only repositories over the Bible tables.
 *
 * The local-SQLite counterpart of the server's `api/bible.py`. The ported web
 * `lib/bible.ts` called HTTP; this runs the same reads against the device DB
 * and returns the same shapes (`@/types/api`), so the ported `useBible` hook
 * works unchanged. The `DbExecutor` first argument is the data seam.
 *
 * Query strategy (mirrors the server, no N+1): each function runs a small fixed
 * number of explicit SELECTs — never a per-verse or per-book lookup. The
 * translation-detail book list is one grouped count query.
 *
 * Error mapping lives here: `references.ts` stays pure and throws
 * `ReferenceParseError`; this layer catches it and throws `ApiError`
 * (INVALID_REFERENCE), alongside the TRANSLATION/BOOK/CHAPTER_NOT_FOUND and
 * REFERENCE_OUT_OF_RANGE cases, exactly as the server's HTTP layer did.
 */

import { getBookByName, type Testament } from '@/lib/bible/books'
import { parseReferenceOrRaise, ReferenceParseError } from '@/lib/bible/references'
import type {
  BookSummary,
  ChapterPointer,
  ChapterResponse,
  CrossRefResponse,
  FootnoteResponse,
  HeadingResponse,
  NoteType,
  ResolvedReferenceResponse,
  TranslationDetailResponse,
  TranslationListResponse,
  TranslationSummary,
  VerseResponse,
} from '@/types/api'

import { ApiError, ErrorCode } from './errors'
import type { DbExecutor } from './executor'

// ---- row shapes (as stored) ------------------------------------------------

interface TranslationRow {
  id: number
  code: string
  name: string
  language: string
  copyright_notice: string
}

interface BookRow {
  id: number
  name: string
  abbreviation: string
  order_index: number
}

interface ChapterRow {
  id: number
  number: number
}

// ---- helpers ---------------------------------------------------------------

function testamentFor(bookName: string): Testament {
  // The loader validates names against ALL_BOOKS, so a non-canonical DB name is
  // a "shouldn't happen"; default to OT and let an integration test catch it.
  return getBookByName(bookName)?.testament ?? 'OT'
}

function toSummary(row: TranslationRow): TranslationSummary {
  return {
    code: row.code,
    name: row.name,
    language: row.language,
    copyright: row.copyright_notice,
  }
}

async function getTranslationByCode(
  executor: DbExecutor,
  code: string,
): Promise<TranslationRow> {
  const rows = await executor.query<TranslationRow>(
    'SELECT id, code, name, language, copyright_notice FROM translations WHERE code = ?',
    [code],
  )
  const translation = rows[0]
  if (translation === undefined) {
    throw new ApiError(404, ErrorCode.TRANSLATION_NOT_FOUND, `translation '${code}' is not loaded`)
  }
  return translation
}

async function defaultTranslation(executor: DbExecutor): Promise<TranslationRow> {
  const rows = await executor.query<TranslationRow>(
    'SELECT id, code, name, language, copyright_notice FROM translations ORDER BY loaded_at ASC, id ASC LIMIT 1',
  )
  const translation = rows[0]
  if (translation === undefined) {
    throw new ApiError(404, ErrorCode.TRANSLATION_NOT_FOUND, 'no translations are loaded')
  }
  return translation
}

async function resolveBook(
  executor: DbExecutor,
  translationId: number,
  bookNameInput: string,
): Promise<BookRow> {
  const canon = getBookByName(bookNameInput)
  if (canon === undefined) {
    throw new ApiError(404, ErrorCode.BOOK_NOT_FOUND, `unknown book name: '${bookNameInput}'`)
  }
  const rows = await executor.query<BookRow>(
    'SELECT id, name, abbreviation, order_index FROM books WHERE translation_id = ? AND name = ?',
    [translationId, canon.name],
  )
  const book = rows[0]
  if (book === undefined) {
    throw new ApiError(
      404,
      ErrorCode.BOOK_NOT_FOUND,
      `'${canon.name}' is not loaded for this translation`,
    )
  }
  return book
}

async function getChapterRow(
  executor: DbExecutor,
  bookId: number,
  chapterNumber: number,
): Promise<ChapterRow> {
  const rows = await executor.query<ChapterRow>(
    'SELECT id, number FROM chapters WHERE book_id = ? AND number = ?',
    [bookId, chapterNumber],
  )
  const chapter = rows[0]
  if (chapter === undefined) {
    throw new ApiError(404, ErrorCode.CHAPTER_NOT_FOUND, `chapter ${chapterNumber} not found`)
  }
  return chapter
}

async function chapterCountFor(executor: DbExecutor, bookId: number): Promise<number> {
  const [{ n }] = await executor.query<{ n: number }>(
    'SELECT COUNT(id) n FROM chapters WHERE book_id = ?',
    [bookId],
  )
  return n
}

async function bookSummaryFor(executor: DbExecutor, book: BookRow): Promise<BookSummary> {
  return {
    name: book.name,
    abbreviation: book.abbreviation,
    order_index: book.order_index,
    testament: testamentFor(book.name),
    chapter_count: await chapterCountFor(executor, book.id),
  }
}

/**
 * Verses for a chapter, each with its footnotes (rich note metadata + nested
 * cross-references). Fixed query budget, no N+1: one SELECT for verses, one for
 * footnotes, and — only when the chapter has footnotes — one for cross-refs
 * (joined to `books` for the target abbreviation). Mirrors the server's
 * `_verses_with_footnotes`. Plain translations come back with the rich fields
 * defaulted (null note fields, ordinal 0, empty cross_refs).
 */
async function versesWithFootnotes(
  executor: DbExecutor,
  chapterId: number,
): Promise<VerseResponse[]> {
  const verseRows = await executor.query<{
    id: number
    number: number
    text: string
    is_red_letter: number
  }>(
    'SELECT id, number, text, is_red_letter FROM verses WHERE chapter_id = ? ORDER BY number ASC',
    [chapterId],
  )
  if (verseRows.length === 0) {
    return []
  }

  const verseIds = verseRows.map((v) => v.id)
  const versePlaceholders = verseIds.map(() => '?').join(', ')
  const footnoteRows = await executor.query<{
    id: number
    verse_id: number
    text: string
    note_type: NoteType | null
    char_offset: number | null
    marker: number | null
    ordinal: number
  }>(
    `SELECT id, verse_id, text, note_type, char_offset, marker, ordinal
       FROM footnotes
      WHERE verse_id IN (${versePlaceholders})
      ORDER BY verse_id ASC, ordinal ASC, id ASC`,
    verseIds,
  )

  // Cross-refs: one query for the whole chapter, joined to books for the target
  // abbreviation — skipped entirely when the chapter has no footnotes.
  const crossRefsByFootnote = new Map<number, CrossRefResponse[]>()
  if (footnoteRows.length > 0) {
    const footnoteIds = footnoteRows.map((f) => f.id)
    const fnPlaceholders = footnoteIds.map(() => '?').join(', ')
    const crossRefRows = await executor.query<{
      footnote_id: number
      to_book: string
      to_chapter: number
      to_verse_start: number
      to_verse_end: number | null
    }>(
      `SELECT cr.footnote_id, b.abbreviation AS to_book, cr.to_chapter, cr.to_verse_start, cr.to_verse_end
         FROM cross_references cr
         JOIN books b ON b.id = cr.to_book_id
        WHERE cr.footnote_id IN (${fnPlaceholders})
        ORDER BY cr.id ASC`,
      footnoteIds,
    )
    for (const cr of crossRefRows) {
      const list = crossRefsByFootnote.get(cr.footnote_id) ?? []
      list.push({
        to_book: cr.to_book,
        to_chapter: cr.to_chapter,
        to_verse_start: cr.to_verse_start,
        to_verse_end: cr.to_verse_end,
      })
      crossRefsByFootnote.set(cr.footnote_id, list)
    }
  }

  const footnotesByVerse = new Map<number, FootnoteResponse[]>()
  for (const fn of footnoteRows) {
    const list = footnotesByVerse.get(fn.verse_id) ?? []
    list.push({
      id: fn.id,
      text: fn.text,
      note_type: fn.note_type,
      char_offset: fn.char_offset,
      marker: fn.marker,
      ordinal: fn.ordinal,
      cross_refs: crossRefsByFootnote.get(fn.id) ?? [],
    })
    footnotesByVerse.set(fn.verse_id, list)
  }

  return verseRows.map((v) => ({
    id: v.id,
    number: v.number,
    text: v.text,
    is_red_letter: v.is_red_letter === 1,
    footnotes: footnotesByVerse.get(v.id) ?? [],
  }))
}

async function headingsFor(executor: DbExecutor, chapterId: number): Promise<HeadingResponse[]> {
  return executor.query<HeadingResponse>(
    'SELECT before_verse, text FROM headings WHERE chapter_id = ? ORDER BY before_verse ASC, id ASC',
    [chapterId],
  )
}

async function previousPointer(
  executor: DbExecutor,
  translationId: number,
  book: BookRow,
  chapterNumber: number,
): Promise<ChapterPointer | null> {
  if (chapterNumber > 1) {
    return { book_name: book.name, chapter_number: chapterNumber - 1 }
  }
  const prev = (
    await executor.query<BookRow>(
      'SELECT id, name, abbreviation, order_index FROM books WHERE translation_id = ? AND order_index < ? ORDER BY order_index DESC LIMIT 1',
      [translationId, book.order_index],
    )
  )[0]
  if (prev === undefined) {
    return null
  }
  const [{ last }] = await executor.query<{ last: number | null }>(
    'SELECT MAX(number) last FROM chapters WHERE book_id = ?',
    [prev.id],
  )
  if (last === null) {
    return null
  }
  return { book_name: prev.name, chapter_number: last }
}

async function nextPointer(
  executor: DbExecutor,
  translationId: number,
  book: BookRow,
  chapterNumber: number,
  maxChapter: number,
): Promise<ChapterPointer | null> {
  if (chapterNumber < maxChapter) {
    return { book_name: book.name, chapter_number: chapterNumber + 1 }
  }
  const next = (
    await executor.query<BookRow>(
      'SELECT id, name, abbreviation, order_index FROM books WHERE translation_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1',
      [translationId, book.order_index],
    )
  )[0]
  if (next === undefined) {
    return null
  }
  const firstChapter = (
    await executor.query<{ number: number }>(
      'SELECT number FROM chapters WHERE book_id = ? ORDER BY number ASC LIMIT 1',
      [next.id],
    )
  )[0]
  if (firstChapter === undefined) {
    return null
  }
  return { book_name: next.name, chapter_number: firstChapter.number }
}

// ---- repositories ----------------------------------------------------------

export async function listTranslations(executor: DbExecutor): Promise<TranslationListResponse> {
  const rows = await executor.query<TranslationRow>(
    'SELECT id, code, name, language, copyright_notice FROM translations ORDER BY loaded_at ASC, id ASC',
  )
  return { translations: rows.map(toSummary) }
}

export async function getTranslationDetail(
  executor: DbExecutor,
  code: string,
): Promise<TranslationDetailResponse> {
  const translation = await getTranslationByCode(executor, code)

  // One grouped query for books-with-chapter-counts; no N+1.
  const rows = await executor.query<{
    name: string
    abbreviation: string
    order_index: number
    chapter_count: number
  }>(
    `SELECT b.name, b.abbreviation, b.order_index, COUNT(c.id) AS chapter_count
       FROM books b
       LEFT JOIN chapters c ON c.book_id = b.id
      WHERE b.translation_id = ?
      GROUP BY b.id
      ORDER BY b.order_index ASC`,
    [translation.id],
  )

  const books: BookSummary[] = rows.map((b) => ({
    name: b.name,
    abbreviation: b.abbreviation,
    order_index: b.order_index,
    testament: testamentFor(b.name),
    chapter_count: b.chapter_count,
  }))

  return { translation: toSummary(translation), books }
}

export async function getChapter(
  executor: DbExecutor,
  code: string,
  bookName: string,
  chapterNumber: number,
): Promise<ChapterResponse> {
  if (chapterNumber < 1) {
    throw new ApiError(404, ErrorCode.CHAPTER_NOT_FOUND, `chapter ${chapterNumber} not found`)
  }

  const translation = await getTranslationByCode(executor, code)
  const book = await resolveBook(executor, translation.id, bookName)
  const chapter = await getChapterRow(executor, book.id, chapterNumber)

  const verses = await versesWithFootnotes(executor, chapter.id)
  const headings = await headingsFor(executor, chapter.id)
  const bookSummary = await bookSummaryFor(executor, book)

  const previous = await previousPointer(executor, translation.id, book, chapterNumber)
  const next = await nextPointer(
    executor,
    translation.id,
    book,
    chapterNumber,
    bookSummary.chapter_count,
  )

  return {
    translation_code: translation.code,
    book: bookSummary,
    chapter_number: chapterNumber,
    verses,
    headings,
    previous,
    next,
  }
}

export async function resolveReference(
  executor: DbExecutor,
  ref: string,
  translationCode?: string,
): Promise<ResolvedReferenceResponse> {
  let parsed
  try {
    parsed = parseReferenceOrRaise(ref)
  } catch (err) {
    if (err instanceof ReferenceParseError) {
      throw new ApiError(400, ErrorCode.INVALID_REFERENCE, err.message)
    }
    throw err
  }

  const translation =
    translationCode !== undefined
      ? await getTranslationByCode(executor, translationCode)
      : await defaultTranslation(executor)

  const book = await resolveBook(executor, translation.id, parsed.book.name)
  const chapter = await getChapterRow(executor, book.id, parsed.chapter)

  const allVerses = await versesWithFootnotes(executor, chapter.id)
  if (allVerses.length === 0) {
    throw new ApiError(404, ErrorCode.CHAPTER_NOT_FOUND, `chapter ${parsed.chapter} has no verses`)
  }

  const lastVerseNumber = allVerses[allVerses.length - 1].number
  let start: number
  let end: number
  if (parsed.startVerse === null) {
    start = 1
    end = lastVerseNumber
  } else {
    start = parsed.startVerse
    end = parsed.endVerse ?? start
    if (start > lastVerseNumber || end > lastVerseNumber) {
      throw new ApiError(
        404,
        ErrorCode.REFERENCE_OUT_OF_RANGE,
        `chapter has ${lastVerseNumber} verses; reference asked for ${start}-${end}`,
      )
    }
  }

  const selected = allVerses.filter((v) => start <= v.number && v.number <= end)
  const bookSummary = await bookSummaryFor(executor, book)

  return {
    reference: {
      canonical_string: parsed.canonicalString,
      translation_code: translation.code,
      book: bookSummary,
      chapter_number: parsed.chapter,
      start_verse: start,
      end_verse: end,
    },
    verses: selected,
  }
}
