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
import type {
  AppliedFilters,
  CalendarResponse,
  EntryCreateRequest,
  EntryListParams,
  EntryListResponse,
  EntryResponse,
  EntryTagSummary,
  OnThisDayResponse,
  PassageEntriesResponse,
} from '@/types/api'

import { resolveReference } from './bible'
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

export async function resolveTags(
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

/** Pure assembly of an EntryResponse from a row + its already-fetched tags. */
function assembleEntry(row: EntryRow, tags: EntryTagSummary[]): EntryResponse {
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
    tags,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function buildEntryResponse(
  executor: DbExecutor,
  row: EntryRow,
): Promise<EntryResponse> {
  const tags = await executor.query<EntryTagSummary>(
    `SELECT t.id, t.name FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id = ?
      ORDER BY lower(t.name) ASC`,
    [row.id],
  )
  return assembleEntry(row, tags)
}

/**
 * Build many EntryResponses with ONE batched tag query (no N+1), mirroring the
 * server's `_build_entries_batch`. Used by the list/on-this-day/passage reads.
 */
async function buildEntriesBatch(
  executor: DbExecutor,
  rows: EntryRow[],
): Promise<EntryResponse[]> {
  if (rows.length === 0) {
    return []
  }
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(', ')
  const tagRows = await executor.query<{ entry_id: number; id: number; name: string }>(
    `SELECT et.entry_id, t.id, t.name FROM tags t
       JOIN entry_tags et ON et.tag_id = t.id
      WHERE et.entry_id IN (${placeholders})
      ORDER BY et.entry_id, lower(t.name) ASC`,
    ids,
  )
  const tagsByEntry = new Map<number, EntryTagSummary[]>()
  for (const tr of tagRows) {
    const list = tagsByEntry.get(tr.entry_id) ?? []
    list.push({ id: tr.id, name: tr.name })
    tagsByEntry.set(tr.entry_id, list)
  }
  return rows.map((row) => assembleEntry(row, tagsByEntry.get(row.id) ?? []))
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

// ---- read side: list / filters (port of core/entries_query.py) -------------

interface ResolvedFilters {
  q: string | null
  bookOrderIndex: number | null
  tagLower: string | null
  fromDate: string | null
  toDate: string | null
}

/** Escape SQL LIKE wildcards so user input matches as a literal substring. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function resolveFilters(
  params: EntryListParams,
): { filters: ResolvedFilters; applied: AppliedFilters } {
  const qStripped = (params.q ?? '').trim()
  const q = qStripped === '' ? null : qStripped

  let bookCanonical: string | null = null
  let bookOrderIndex: number | null = null
  if (params.book !== null && params.book !== undefined && params.book.trim() !== '') {
    const canon = getBookByName(params.book.trim())
    if (canon === undefined) {
      throw new ApiError(400, ErrorCode.INVALID_BOOK, `unknown book: '${params.book}'`)
    }
    bookCanonical = canon.name
    bookOrderIndex = canon.order_index
  }

  let tagValue: string | null = null
  let tagLower: string | null = null
  if (params.tag !== null && params.tag !== undefined && params.tag.trim() !== '') {
    tagValue = params.tag.trim()
    tagLower = tagValue.toLowerCase()
  }

  const fromDate = params.from_date ?? null
  const toDate = params.to_date ?? null
  if (fromDate !== null && toDate !== null && fromDate > toDate) {
    throw new ApiError(
      400,
      ErrorCode.INVALID_DATE_RANGE,
      `from_date ${fromDate} is after to_date ${toDate}`,
    )
  }

  return {
    filters: { q, bookOrderIndex, tagLower, fromDate, toDate },
    applied: { q, book: bookCanonical, tag: tagValue, from_date: fromDate, to_date: toDate },
  }
}

/** Build the shared WHERE clause + params applied to both count and page selects. */
function buildWhere(filters: ResolvedFilters): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters.q !== null) {
    const pattern = `%${escapeLike(filters.q.toLowerCase())}%`
    conditions.push(
      `(lower(title) LIKE ? ESCAPE '\\' OR lower(observation) LIKE ? ESCAPE '\\'` +
        ` OR lower(application) LIKE ? ESCAPE '\\' OR lower(prayer) LIKE ? ESCAPE '\\'` +
        ` OR lower(scripture_text) LIKE ? ESCAPE '\\')`,
    )
    params.push(pattern, pattern, pattern, pattern, pattern)
  }

  if (filters.bookOrderIndex !== null) {
    conditions.push(
      'EXISTS (SELECT 1 FROM entry_scripture_verses esv WHERE esv.entry_id = entries.id AND esv.book_order_index = ?)',
    )
    params.push(filters.bookOrderIndex)
  }

  if (filters.tagLower !== null) {
    conditions.push(
      'EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = entries.id AND t.name_lower = ?)',
    )
    params.push(filters.tagLower)
  }

  if (filters.fromDate !== null) {
    conditions.push('entry_date >= ?')
    params.push(filters.fromDate)
  }
  if (filters.toDate !== null) {
    conditions.push('entry_date <= ?')
    params.push(filters.toDate)
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { clause, params }
}

export async function listEntries(
  executor: DbExecutor,
  params: EntryListParams = {},
): Promise<EntryListResponse> {
  const { filters, applied } = resolveFilters(params)
  const { clause, params: whereParams } = buildWhere(filters)

  const limit = params.limit ?? 20
  const offset = params.offset ?? 0
  const order = params.order ?? 'newest'
  const direction = order === 'oldest' ? 'ASC' : 'DESC'

  const [{ total }] = await executor.query<{ total: number }>(
    `SELECT COUNT(id) total FROM entries ${clause}`,
    whereParams,
  )

  const rows = await executor.query<EntryRow>(
    `SELECT * FROM entries ${clause}
      ORDER BY entry_date ${direction}, created_at ${direction}, id ${direction}
      LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset],
  )

  const entries = await buildEntriesBatch(executor, rows)
  return { entries, total, limit, offset, applied_filters: applied }
}

// ---- calendar + on-this-day (TEXT-date queries) ----------------------------

export async function calendar(
  executor: DbExecutor,
  year: number,
  month: number,
): Promise<CalendarResponse> {
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  const rows = await executor.query<{ entry_date: string; count: number }>(
    `SELECT entry_date, COUNT(id) count FROM entries
      WHERE substr(entry_date, 1, 7) = ?
      GROUP BY entry_date
      ORDER BY entry_date ASC`,
    [prefix],
  )
  const days = rows.map((r) => ({ entry_date: r.entry_date, count: r.count }))
  const total = days.reduce((sum, d) => sum + d.count, 0)
  return { year, month, days, total }
}

export async function onThisDay(
  executor: DbExecutor,
  referenceDate: string = new Date().toISOString().slice(0, 10),
  yearsBack = 10,
): Promise<OnThisDayResponse> {
  const monthDay = referenceDate.slice(5, 10) // "MM-DD"
  const targetYear = Number(referenceDate.slice(0, 4))
  const earliestYear = targetYear - yearsBack

  const rows = await executor.query<EntryRow>(
    `SELECT * FROM entries
      WHERE substr(entry_date, 6, 5) = ?
        AND CAST(substr(entry_date, 1, 4) AS INTEGER) < ?
        AND CAST(substr(entry_date, 1, 4) AS INTEGER) >= ?
      ORDER BY entry_date DESC, created_at DESC, id DESC`,
    [monthDay, targetYear, earliestYear],
  )
  const entries = await buildEntriesBatch(executor, rows)
  return { target_date: referenceDate, entries }
}

// ---- passage -> entries (Model B coordinate match, translation-agnostic) ---

export async function getPassageEntries(
  executor: DbExecutor,
  ref: string,
  translationCode?: string,
): Promise<PassageEntriesResponse> {
  // Reuse the reader resolver: validates the reference (INVALID_REFERENCE /
  // TRANSLATION_NOT_FOUND / BOOK/CHAPTER_NOT_FOUND / REFERENCE_OUT_OF_RANGE) and
  // gives the canonical ResolvedReference echo.
  const { reference } = await resolveReference(executor, ref, translationCode)

  // Match entries by canonical coordinates — no joins to verses/chapters/books,
  // and translation-agnostic (Model B): an entry journaled in any translation
  // surfaces for the same book+chapter.
  const rows = await executor.query<EntryRow>(
    `SELECT * FROM entries e
      WHERE EXISTS (
        SELECT 1 FROM entry_scripture_verses esv
         WHERE esv.entry_id = e.id
           AND esv.book_order_index = ?
           AND esv.chapter_number = ?
      )
      ORDER BY entry_date DESC, created_at DESC, id DESC`,
    [reference.book.order_index, reference.chapter_number],
  )
  const entries = await buildEntriesBatch(executor, rows)
  return { reference, count: entries.length, entries }
}
