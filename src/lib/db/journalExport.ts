/**
 * Journal export: read the whole journal (entries + tag names + verse
 * coordinates) and serialize it to a backup document.
 *
 * Journal-only (Model B): no Bible text, no `user_id`. Timestamps
 * (`created_at`/`updated_at`/`entry_date`) are preserved verbatim so recency and
 * "on this day" stay meaningful after a restore. Pure read + serialize — no
 * Capacitor, no file/share concerns (that's the `backupShare` shim). The output
 * is shaped to pass `validateBackup`.
 */

import type { Backup, BackupEntry, BackupVerse } from '@/lib/schema/backup'

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

/**
 * Build the backup document for the entire journal. `exportedAt` is injected
 * (ISO-8601 UTC) so it's set in app code and pinnable in tests. An empty journal
 * yields a valid document with `entries: []`.
 */
export async function buildBackup(db: DbExecutor, exportedAt: string): Promise<Backup> {
  const rows = await db.query<EntryRow>(
    `SELECT * FROM entries ORDER BY id ASC`,
  )

  const entries: BackupEntry[] = []
  for (const row of rows) {
    const tagRows = await db.query<{ name: string }>(
      `SELECT t.name FROM tags t
         JOIN entry_tags et ON et.tag_id = t.id
        WHERE et.entry_id = ?
        ORDER BY lower(t.name) ASC`,
      [row.id],
    )
    const verseRows = await db.query<{
      book_order_index: number
      chapter_number: number
      verse_number: number
    }>(
      `SELECT book_order_index, chapter_number, verse_number
         FROM entry_scripture_verses
        WHERE entry_id = ?
        ORDER BY book_order_index ASC, chapter_number ASC, verse_number ASC`,
      [row.id],
    )

    const verses: BackupVerse[] = verseRows.map((v) => ({
      book_order_index: v.book_order_index,
      chapter: v.chapter_number,
      verse: v.verse_number,
    }))

    entries.push({
      title: row.title,
      entry_date: row.entry_date,
      scripture_ref: row.scripture_ref,
      scripture_translation_code: row.scripture_translation_code,
      scripture_text: row.scripture_text,
      observation: row.observation,
      application: row.application,
      prayer: row.prayer,
      created_at: row.created_at,
      updated_at: row.updated_at,
      verses,
      tags: tagRows.map((t) => t.name),
    })
  }

  return {
    format: 'soap-journal-backup',
    version: 1,
    exported_at: exportedAt,
    entries,
  }
}
