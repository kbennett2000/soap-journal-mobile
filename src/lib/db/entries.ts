/**
 * SOAP journal entry write path — save (create/update), get, delete.
 *
 * The local-SQLite counterpart of the server's `core/entries.py` save pipeline
 * and `api/entries.py` get/delete. The ported web `lib/entries.ts` called HTTP
 * and unwrapped the `{entry}` envelope; this returns the same `EntryResponse`,
 * so the ported `useEntries`/`EntryForm` work unchanged. The `DbExecutor` first
 * argument is the data seam.
 *
 * Model B (vs the server's Model A): no `user_id`; the entry stores
 * `scripture_translation_code` (text, stable across re-import); and the verse
 * linkage is canonical coordinates `(book_order_index, chapter_number,
 * verse_number)` — never `verse_id`, so re-importing a translation can't orphan
 * a journal entry. Error mapping lives here; `references.ts` stays pure.
 */

import { getBookByName } from '@/lib/bible/books'
import { parseReferenceOrRaise, ReferenceParseError } from '@/lib/bible/references'
import type { EntryCreateRequest, EntryResponse, EntryTagSummary } from '@/types/api'

import { ApiError, ErrorCode } from './errors'
import type { DbExecutor } from './executor'

interface EntryRow {
  id: number
  title: string | null
  entry_date: string
  scripture_ref: string
  scripture_translation_code: string
  scripture_text: string
  observation: string
  application: string
  prayer: string
  created_at: string
  updated_at: string
}

interface TranslationRow {
  id: number
  code: string
}

interface ResolvedScripture {
  canonicalString: string
  translationCode: string
  bookOrderIndex: number
  chapterNumber: number
  /** Verses in range, ordered; only number + text are needed. */
  verses: { number: number; text: string }[]
}

// ---- scripture resolution (mirrors core/entries._resolve_scripture) --------

async function resolveTranslation(
  executor: DbExecutor,
  code: string | null | undefined,
): Promise<TranslationRow> {
  if (code !== null && code !== undefined) {
    const row = (
      await executor.query<TranslationRow>('SELECT id, code FROM translations WHERE code = ?', [
        code,
      ])
    )[0]
    if (row === undefined) {
      throw new ApiError(404, ErrorCode.TRANSLATION_NOT_FOUND, `translation '${code}' is not loaded`)
    }
    return row
  }
  const row = (
    await executor.query<TranslationRow>(
      'SELECT id, code FROM translations ORDER BY loaded_at ASC, id ASC LIMIT 1',
    )
  )[0]
  if (row === undefined) {
    throw new ApiError(404, ErrorCode.TRANSLATION_NOT_FOUND, 'no translations are loaded')
  }
  return row
}

async function resolveScripture(
  executor: DbExecutor,
  scriptureRef: string,
  translationCode: string | null | undefined,
): Promise<ResolvedScripture> {
  let parsed
  try {
    parsed = parseReferenceOrRaise(scriptureRef)
  } catch (err) {
    if (err instanceof ReferenceParseError) {
      throw new ApiError(400, ErrorCode.INVALID_REFERENCE, err.message)
    }
    throw err
  }

  const translation = await resolveTranslation(executor, translationCode)

  // The parser already resolved the canonical book.
  const canonBook = getBookByName(parsed.book.name)!

  const book = (
    await executor.query<{ id: number }>(
      'SELECT id FROM books WHERE translation_id = ? AND name = ?',
      [translation.id, canonBook.name],
    )
  )[0]
  if (book === undefined) {
    throw new ApiError(
      404,
      ErrorCode.BOOK_NOT_FOUND,
      `'${canonBook.name}' is not loaded for translation '${translation.code}'`,
    )
  }

  const chapter = (
    await executor.query<{ id: number }>(
      'SELECT id FROM chapters WHERE book_id = ? AND number = ?',
      [book.id, parsed.chapter],
    )
  )[0]
  if (chapter === undefined) {
    throw new ApiError(
      404,
      ErrorCode.CHAPTER_NOT_FOUND,
      `chapter ${parsed.chapter} not found in ${canonBook.name}`,
    )
  }

  const allVerses = await executor.query<{ number: number; text: string }>(
    'SELECT number, text FROM verses WHERE chapter_id = ? ORDER BY number ASC',
    [chapter.id],
  )
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

  return {
    canonicalString: parsed.canonicalString,
    translationCode: translation.code,
    bookOrderIndex: canonBook.order_index,
    chapterNumber: parsed.chapter,
    verses: allVerses.filter((v) => start <= v.number && v.number <= end),
  }
}

// ---- tag get-or-create (mirrors core/entries._resolve_tags, no user_id) ----

async function resolveTags(
  executor: DbExecutor,
  names: string[],
  now: string,
): Promise<number[]> {
  // Dedupe case-insensitively; first occurrence's casing wins; preserve order.
  const seen = new Map<string, string>()
  for (const raw of names) {
    const stripped = raw.trim()
    if (stripped === '') {
      continue
    }
    const key = stripped.toLowerCase()
    if (!seen.has(key)) {
      seen.set(key, stripped)
    }
  }
  if (seen.size === 0) {
    return []
  }

  const keys = [...seen.keys()]
  const placeholders = keys.map(() => '?').join(', ')
  const existing = await executor.query<{ id: number; name_lower: string }>(
    `SELECT id, name_lower FROM tags WHERE name_lower IN (${placeholders})`,
    keys,
  )
  const byLower = new Map(existing.map((t) => [t.name_lower, t.id]))

  const ids: number[] = []
  for (const key of keys) {
    let id = byLower.get(key)
    if (id === undefined) {
      const result = await executor.run('INSERT INTO tags (name, created_at) VALUES (?, ?)', [
        seen.get(key),
        now,
      ])
      id = result.lastInsertRowid
    }
    ids.push(id)
  }
  return ids
}

// ---- response building (shared; reused by 7b) ------------------------------

export async function buildEntryResponse(
  executor: DbExecutor,
  row: EntryRow,
): Promise<EntryResponse> {
  const tagRows = await executor.query<EntryTagSummary>(
    `SELECT t.id, t.name FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id = ?
      ORDER BY lower(t.name) ASC`,
    [row.id],
  )

  const title = (row.title ?? '').trim() || null
  const displayTitle = title ?? row.scripture_ref

  return {
    id: row.id,
    title,
    display_title: displayTitle,
    entry_date: row.entry_date,
    scripture_ref: row.scripture_ref,
    translation_code: row.scripture_translation_code,
    scripture_text: row.scripture_text,
    observation: row.observation,
    application: row.application,
    prayer: row.prayer,
    tags: tagRows,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function getEntryRow(executor: DbExecutor, id: number): Promise<EntryRow> {
  const row = (await executor.query<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]))[0]
  if (row === undefined) {
    throw new ApiError(404, ErrorCode.ENTRY_NOT_FOUND, `entry ${id} not found`)
  }
  return row
}

// ---- public API ------------------------------------------------------------

/**
 * Create (no `entryId`) or replace (with `entryId`) a SOAP entry, returning the
 * full `EntryResponse`. The whole pipeline runs in one transaction, so a
 * mid-save failure leaves no partial entry. `now` is injected for testability;
 * it provides created_at/updated_at and the default entry_date.
 */
export async function saveEntry(
  executor: DbExecutor,
  input: EntryCreateRequest,
  entryId?: number,
  now: string = new Date().toISOString(),
): Promise<EntryResponse> {
  return executor.transaction(async (tx) => {
    // Confirm an update target exists first (matches the server's pre-pipeline
    // 404 check), so a valid reference can't mask a missing entry.
    if (entryId !== undefined) {
      await getEntryRow(tx, entryId)
    }

    const resolved = await resolveScripture(tx, input.scripture_ref, input.translation_code)
    const scriptureText = resolved.verses.map((v) => v.text).join(' ')
    const title = (input.title ?? '').trim() || null
    const entryDate = input.entry_date ?? now.slice(0, 10)
    const observation = input.observation ?? ''
    const application = input.application ?? ''
    const prayer = input.prayer ?? ''

    let id: number
    if (entryId === undefined) {
      const result = await tx.run(
        `INSERT INTO entries
           (title, entry_date, scripture_ref, scripture_translation_code, scripture_text,
            observation, application, prayer, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          entryDate,
          resolved.canonicalString,
          resolved.translationCode,
          scriptureText,
          observation,
          application,
          prayer,
          now,
          now,
        ],
      )
      id = result.lastInsertRowid
    } else {
      // Replace-not-patch; created_at is left untouched.
      await tx.run(
        `UPDATE entries SET
           title = ?, entry_date = ?, scripture_ref = ?, scripture_translation_code = ?,
           scripture_text = ?, observation = ?, application = ?, prayer = ?, updated_at = ?
         WHERE id = ?`,
        [
          title,
          entryDate,
          resolved.canonicalString,
          resolved.translationCode,
          scriptureText,
          observation,
          application,
          prayer,
          now,
          entryId,
        ],
      )
      id = entryId
    }

    // Rebuild verse linkage as Model B coordinates.
    await tx.run('DELETE FROM entry_scripture_verses WHERE entry_id = ?', [id])
    if (resolved.verses.length > 0) {
      await tx.runMany(
        'INSERT INTO entry_scripture_verses (entry_id, book_order_index, chapter_number, verse_number) VALUES (?, ?, ?, ?)',
        resolved.verses.map((v) => [id, resolved.bookOrderIndex, resolved.chapterNumber, v.number]),
      )
    }

    // Rebuild tag linkage (orphaned tag rows are intentionally kept).
    const tagIds = await resolveTags(tx, input.tags ?? [], now)
    await tx.run('DELETE FROM entry_tags WHERE entry_id = ?', [id])
    if (tagIds.length > 0) {
      await tx.runMany(
        'INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)',
        tagIds.map((tagId) => [id, tagId]),
      )
    }

    const row = await getEntryRow(tx, id)
    return buildEntryResponse(tx, row)
  })
}

export async function getEntry(executor: DbExecutor, id: number): Promise<EntryResponse> {
  const row = await getEntryRow(executor, id)
  return buildEntryResponse(executor, row)
}

export async function deleteEntry(executor: DbExecutor, id: number): Promise<void> {
  await getEntryRow(executor, id) // ENTRY_NOT_FOUND if missing
  // ON DELETE CASCADE (migration v1) clears entry_tags + entry_scripture_verses.
  // Tag rows themselves are never deleted.
  await executor.run('DELETE FROM entries WHERE id = ?', [id])
}
