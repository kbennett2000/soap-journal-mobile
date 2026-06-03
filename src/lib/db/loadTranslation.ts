/**
 * Shared canonical-insert routine: a validated CanonicalTranslation -> the DB.
 *
 * The single write path for Bible data, called by BOTH the in-app import flow
 * (one load) and the build-bible-db script (13 loads). Ported 1:1 from the
 * server's `load_canonical_translation` (cli/load_translation.py).
 *
 * It consumes an ALREADY-VALIDATED payload (the cycle-3 inferred
 * `CanonicalTranslation`) and does NOT re-validate — callers validate first
 * with `validateCanonicalTranslation`, the same split the server keeps between
 * its CLI wrapper (validates) and this routine (inserts). In particular it
 * trusts that every footnote.verse_number references a real verse in its
 * chapter.
 *
 * Bible tables only (translations/books/chapters/verses/headings/footnotes);
 * untouched by Model B, so it ports directly. See docs/schema.md.
 */

import type { CanonicalCrossRef, CanonicalTranslation } from '@/lib/schema/canonical'

import type { DbExecutor } from './executor'

export interface TranslationCounts {
  books: number
  chapters: number
  verses: number
}

/**
 * Replace-or-insert a translation by `code`, returning (books, chapters,
 * verses) counts. The delete+insert run in one transaction (self-wrapped), so
 * a failure can never leave a half-deleted translation. Because it manages its
 * own transaction, callers must not wrap it in another one.
 *
 * @param loadedAt ISO-8601 UTC timestamp written to `translations.loaded_at`;
 *   defaults to now. Injected so timestamps are set in app code (and pinned in
 *   tests).
 */
export async function loadTranslation(
  executor: DbExecutor,
  payload: CanonicalTranslation,
  loadedAt: string = new Date().toISOString(),
): Promise<TranslationCounts> {
  await executor.transaction(async (tx) => {
    // Replace-by-code: a single cascading delete clears the whole
    // translation -> books -> chapters -> verses -> headings/footnotes tree
    // (migration v1's ON DELETE CASCADE + foreign_keys = ON). No-op if absent.
    await tx.run('DELETE FROM translations WHERE code = ?', [payload.code])

    const translation = await tx.run(
      'INSERT INTO translations (code, name, language, copyright_notice, loaded_at) VALUES (?, ?, ?, ?, ?)',
      [payload.code, payload.name, payload.language, payload.copyright, loadedAt],
    )
    const translationId = translation.lastInsertRowid

    // order_index -> inserted book id (THIS translation), to resolve cross-ref
    // targets in a second pass after every book exists (a ref may point at a
    // book inserted later). Mirrors the server's `book_id_by_order`.
    const bookIdByOrder = new Map<number, number>()
    const pendingCrossRefs: {
      footnoteId: number
      fromVerseId: number
      crossRefs: CanonicalCrossRef[]
    }[] = []

    for (const canonicalBook of payload.books) {
      const book = await tx.run(
        'INSERT INTO books (translation_id, name, abbreviation, order_index) VALUES (?, ?, ?, ?)',
        [translationId, canonicalBook.name, canonicalBook.abbreviation, canonicalBook.order_index],
      )
      const bookId = book.lastInsertRowid
      bookIdByOrder.set(canonicalBook.order_index, bookId)

      for (const canonicalChapter of canonicalBook.chapters) {
        const chapter = await tx.run(
          'INSERT INTO chapters (book_id, number) VALUES (?, ?)',
          [bookId, canonicalChapter.number],
        )
        const chapterId = chapter.lastInsertRowid

        // Verses in bulk. is_red_letter is normalized boolean -> 0/1: the
        // column is INTEGER and better-sqlite3 rejects boolean binds.
        await tx.runMany(
          'INSERT INTO verses (chapter_id, number, text, is_red_letter) VALUES (?, ?, ?, ?)',
          canonicalChapter.verses.map((v) => [
            chapterId,
            v.number,
            v.text,
            v.is_red_letter ? 1 : 0,
          ]),
        )

        if (canonicalChapter.headings.length > 0) {
          await tx.runMany(
            'INSERT INTO headings (chapter_id, before_verse, text) VALUES (?, ?, ?)',
            canonicalChapter.headings.map((h) => [chapterId, h.before_verse, h.text]),
          )
        }

        if (canonicalChapter.footnotes.length > 0) {
          // Resolve footnote verse_number -> verse id within this chapter.
          // Mirrors the server's per-chapter verse_rows map.
          const verseRows = await tx.query<{ id: number; number: number }>(
            'SELECT id, number FROM verses WHERE chapter_id = ?',
            [chapterId],
          )
          const verseIdByNumber = new Map(verseRows.map((r) => [r.number, r.id]))

          const footnoteSql =
            'INSERT INTO footnotes (verse_id, text, note_type, char_offset, marker, ordinal) VALUES (?, ?, ?, ?, ?, ?)'
          // ordinal is NOT NULL; a plain (unordered) footnote falls back to 0.
          const footnoteValues = (f: (typeof canonicalChapter.footnotes)[number]) => [
            verseIdByNumber.get(f.verse_number),
            f.text,
            f.note_type,
            f.char_offset,
            f.marker,
            f.ordinal ?? 0,
          ]

          // Plain footnotes (the common case — the 13 bundled translations)
          // stay on the bulk path. Only cross-ref-bearing footnotes need their
          // own id, so insert those with run() to capture lastInsertRowid; the
          // cross-references themselves go in after all books exist.
          const plain = canonicalChapter.footnotes.filter((f) => f.cross_refs.length === 0)
          if (plain.length > 0) {
            await tx.runMany(footnoteSql, plain.map(footnoteValues))
          }
          for (const f of canonicalChapter.footnotes) {
            if (f.cross_refs.length === 0) continue
            const inserted = await tx.run(footnoteSql, footnoteValues(f))
            pendingCrossRefs.push({
              footnoteId: inserted.lastInsertRowid,
              fromVerseId: verseIdByNumber.get(f.verse_number) as number,
              crossRefs: f.cross_refs,
            })
          }
        }
      }
    }

    // Second pass: now that every book is inserted, resolve cross-ref targets
    // (to_book_order_index -> this translation's book id) and bulk-insert.
    const crossRefRows = pendingCrossRefs.flatMap(({ footnoteId, fromVerseId, crossRefs }) =>
      crossRefs.map((cr) => [
        footnoteId,
        fromVerseId,
        bookIdByOrder.get(cr.to_book_order_index),
        cr.to_chapter,
        cr.to_verse_start,
        cr.to_verse_end,
      ]),
    )
    if (crossRefRows.length > 0) {
      await tx.runMany(
        'INSERT INTO cross_references (footnote_id, from_verse_id, to_book_id, to_chapter, to_verse_start, to_verse_end) VALUES (?, ?, ?, ?, ?, ?)',
        crossRefRows,
      )
    }
  })

  return countTranslation(payload)
}

/**
 * Count (books, chapters, verses) in a canonical payload. Mirrors the server's
 * `translation_counts` so the loader reports the same numbers a validator would.
 */
export function countTranslation(payload: CanonicalTranslation): TranslationCounts {
  const books = payload.books.length
  let chapters = 0
  let verses = 0
  for (const book of payload.books) {
    chapters += book.chapters.length
    for (const chapter of book.chapters) {
      verses += chapter.verses.length
    }
  }
  return { books, chapters, verses }
}
