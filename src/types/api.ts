/**
 * Response shapes for the data layer, mirroring the soap-journal web frontend's
 * `types/api.ts` so the ported hooks and components consume them unchanged.
 * Where the web app received these as JSON over HTTP, this app's `lib/db`
 * repositories return the same shapes from local SQLite.
 *
 * Fields are snake_case: they are the canonical JSON/response contract shared
 * with the server, not internal app structures.
 *
 * This file grows per cycle. Cycle 6 adds the Bible-reader types; entry/tag/
 * passage types arrive with their repositories.
 */

// One definition of Testament lives in the books module; re-export it so
// consumers importing from `@/types/api` (as the ported UI does) still get it.
export type { Testament } from '@/lib/bible/books'

import type { Testament } from '@/lib/bible/books'

export interface TranslationSummary {
  code: string
  name: string
  language: string
  copyright: string
}

export interface TranslationListResponse {
  translations: TranslationSummary[]
}

export interface BookSummary {
  name: string
  abbreviation: string
  order_index: number
  testament: Testament
  chapter_count: number
}

export interface TranslationDetailResponse {
  translation: TranslationSummary
  books: BookSummary[]
}

/** Typed-note category. Must stay in lockstep with `NoteTypeSchema` in `lib/schema/canonical.ts`. */
export type NoteType = 'tn' | 'sn' | 'tc' | 'map'

/** A cross-reference from a note to a verse (or range) in the same translation. */
export interface CrossRefResponse {
  to_book: string // target book abbreviation (resolved within this translation)
  to_chapter: number
  to_verse_start: number
  to_verse_end: number | null
}

export interface FootnoteResponse {
  id: number
  text: string
  // Rich-note fields. Plain footnotes (the bundled translations) come back with
  // null note fields, ordinal 0, and no cross-refs — clients branch on note_type.
  note_type: NoteType | null
  char_offset: number | null
  marker: number | null
  ordinal: number
  cross_refs: CrossRefResponse[]
}

export interface VerseResponse {
  id: number
  number: number
  text: string
  is_red_letter: boolean
  footnotes: FootnoteResponse[]
}

export interface HeadingResponse {
  before_verse: number
  text: string
}

export interface ChapterPointer {
  book_name: string
  chapter_number: number
}

export interface ChapterResponse {
  translation_code: string
  book: BookSummary
  chapter_number: number
  verses: VerseResponse[]
  headings: HeadingResponse[]
  previous: ChapterPointer | null
  next: ChapterPointer | null
}

export interface ResolvedReference {
  canonical_string: string
  translation_code: string
  book: BookSummary
  chapter_number: number
  start_verse: number
  end_verse: number
}

export interface ResolvedReferenceResponse {
  reference: ResolvedReference
  verses: VerseResponse[]
}

// ---- entries (cycle 7a: write path) ----------------------------------------

export interface EntryTagSummary {
  id: number
  name: string
}

export interface EntryResponse {
  id: number
  title: string | null
  display_title: string
  entry_date: string // ISO YYYY-MM-DD
  scripture_ref: string
  translation_code: string
  scripture_text: string
  observation: string
  application: string
  prayer: string
  tags: EntryTagSummary[]
  created_at: string // ISO-8601 UTC
  updated_at: string // ISO-8601 UTC
}

export interface EntryCreateRequest {
  title?: string | null
  entry_date?: string | null // ISO YYYY-MM-DD
  scripture_ref: string
  translation_code?: string | null
  observation?: string
  application?: string
  prayer?: string
  tags?: string[]
}

export type EntryUpdateRequest = EntryCreateRequest

// ---- entries (cycle 7b: read side) -----------------------------------------

export type EntryListOrder = 'newest' | 'oldest'

export interface EntryListParams {
  limit?: number
  offset?: number
  order?: EntryListOrder
  q?: string | null
  book?: string | null
  tag?: string | null
  from_date?: string | null // ISO YYYY-MM-DD
  to_date?: string | null
}

export interface AppliedFilters {
  q: string | null
  book: string | null
  tag: string | null
  from_date: string | null
  to_date: string | null
}

export interface EntryListResponse {
  entries: EntryResponse[]
  total: number
  limit: number
  offset: number
  applied_filters: AppliedFilters
}

export interface CalendarDay {
  entry_date: string // ISO YYYY-MM-DD
  count: number
}

export interface CalendarResponse {
  year: number
  month: number
  days: CalendarDay[]
  total: number
}

export interface OnThisDayResponse {
  target_date: string // ISO YYYY-MM-DD
  entries: EntryResponse[]
}

export interface PassageEntriesResponse {
  reference: ResolvedReference
  count: number
  entries: EntryResponse[]
}

// ---- tags (cycle 8: read repository) ---------------------------------------

export interface TagSummary {
  id: number
  name: string
  entry_count: number
}

export interface TagListResponse {
  tags: TagSummary[]
}

export interface TagAutocompleteResponse {
  tags: TagSummary[]
}
