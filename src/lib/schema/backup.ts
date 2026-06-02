/**
 * Backup document schema — the journal export/restore format.
 *
 * A backup is journal-only: entries, their tag names, and their verse
 * coordinates. Bible text is NOT backed up (translations are re-importable; see
 * `lib/schema/canonical.ts`). The `version` here is the backup FORMAT version,
 * independent of the DB `user_version`.
 *
 * This is the contract between export (cycle 16a, `lib/db/journalExport.ts`) and
 * restore (16b). Export validates its own output against this schema; restore
 * validates the untrusted input file against it before touching the DB —
 * validate-before-destroy, the same split the import flow keeps.
 *
 * Pure module: structure only, no DB access and no UX mapping.
 */

import { z } from 'zod'

/**
 * A verse coordinate. Short field names by design (`chapter`/`verse`), distinct
 * from the DB columns (`chapter_number`/`verse_number`) — export/restore map
 * between the two.
 */
export const BackupVerseSchema = z
  .object({
    book_order_index: z.number().int().min(1).max(66),
    chapter: z.number().int().min(1),
    verse: z.number().int().min(1),
  })
  .strict()

export const BackupEntrySchema = z
  .object({
    title: z.string().nullable(),
    entry_date: z.string().min(1),
    scripture_ref: z.string().min(1),
    scripture_translation_code: z.string().min(1),
    scripture_text: z.string(),
    observation: z.string(),
    application: z.string(),
    prayer: z.string(),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
    verses: z.array(BackupVerseSchema),
    tags: z.array(z.string()),
  })
  .strict()

export const BackupSchema = z
  .object({
    format: z.literal('soap-journal-backup'),
    version: z.literal(1),
    exported_at: z.string().min(1),
    entries: z.array(BackupEntrySchema),
  })
  .strict()

export type BackupVerse = z.infer<typeof BackupVerseSchema>
export type BackupEntry = z.infer<typeof BackupEntrySchema>
export type Backup = z.infer<typeof BackupSchema>

export type BackupValidationResult =
  | { success: true; data: Backup }
  | { success: false; errors: string[] }

/**
 * Validate an already-parsed JSON value against the backup schema. Returns the
 * typed data on success, or a list of readable error strings on failure. Pure:
 * the caller does `JSON.parse` and maps errors to UX; this does neither.
 */
export function validateBackup(input: unknown): BackupValidationResult {
  const result = BackupSchema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  return { success: false, errors }
}
