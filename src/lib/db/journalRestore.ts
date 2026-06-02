/**
 * Journal restore — the destructive half of backup/restore. Replace, not merge:
 * validate the WHOLE backup, then in ONE transaction wipe the journal and
 * re-insert it verbatim.
 *
 * Two non-negotiable safety rules (docs/backup-and-restore.md):
 *  1. Validate-before-destroy — `parseBackup` fully validates before any write;
 *     an invalid file changes nothing.
 *  2. Transactional — `restoreJournal` does the wipe + insert in one
 *     `executor.transaction`, so a mid-restore failure rolls back to the exact
 *     pre-restore state.
 *
 * Inserts are VERBATIM — restore does NOT route through `saveEntry` (which would
 * re-parse the reference, re-resolve the translation against the Bible tables,
 * re-snapshot text, and regenerate timestamps/coordinates). The backup already
 * carries the snapshot text, translation code, and coordinates, so restore works
 * with no translation loaded (Model B self-containment). Tags are get-or-created
 * by name, reusing the same helper as the save path.
 */

import { resolveTags } from '@/lib/db/entries'
import type { Backup } from '@/lib/schema/backup'
import { validateBackup } from '@/lib/schema/backup'

import type { DbExecutor } from './executor'

/** The latest backup `version` this app can restore. */
const SUPPORTED_VERSION = 1

export type RestoreErrorKind = 'parse' | 'version' | 'validation' | 'restore'

export class RestoreError extends Error {
  readonly kind: RestoreErrorKind
  /** Per-field validation messages (only for `kind === 'validation'`). */
  readonly errors?: string[]
  /** The underlying error, when this wraps one (e.g. a DB failure). */
  readonly cause?: unknown

  constructor(kind: RestoreErrorKind, message: string, errors?: string[], cause?: unknown) {
    super(message)
    this.name = 'RestoreError'
    this.kind = kind
    this.errors = errors
    this.cause = cause
  }
}

/**
 * Parse + validate untrusted backup text. Pure: NO database access — this is the
 * validate-before-destroy gate the UI runs before showing the confirm. Throws a
 * `RestoreError` (parse / version / validation); never writes anything.
 */
export function parseBackup(text: string): Backup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new RestoreError('parse', "That file isn't valid JSON.")
  }

  // A friendlier message than the generic schema error for a too-new backup.
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    typeof (parsed as { version?: unknown }).version === 'number' &&
    (parsed as { version: number }).version > SUPPORTED_VERSION
  ) {
    throw new RestoreError(
      'version',
      'This backup is from a newer version of the app. Update the app, then restore.',
    )
  }

  const result = validateBackup(parsed)
  if (!result.success) {
    throw new RestoreError('validation', "This file isn't a valid backup.", result.errors)
  }
  return result.data
}

/**
 * Destructively replace the journal with `backup`, in one transaction. Takes an
 * ALREADY-VALIDATED backup (call `parseBackup` first). On any failure the
 * transaction rolls back, leaving the existing journal untouched.
 *
 * @param now ISO-8601 UTC used for newly-created tag rows' `created_at`
 *   (entries keep their own backed-up timestamps). Injected for test pinning.
 */
export async function restoreJournal(
  db: DbExecutor,
  backup: Backup,
  now: string = new Date().toISOString(),
): Promise<{ entryCount: number }> {
  try {
    return await db.transaction(async (tx) => {
      // Wipe the journal — explicit deletes in FK-safe order (children first).
      await tx.run('DELETE FROM entry_tags')
      await tx.run('DELETE FROM entry_scripture_verses')
      await tx.run('DELETE FROM entries')
      await tx.run('DELETE FROM tags')

      for (const entry of backup.entries) {
        const { lastInsertRowid: id } = await tx.run(
          `INSERT INTO entries
             (title, entry_date, scripture_ref, scripture_translation_code, scripture_text,
              observation, application, prayer, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.title,
            entry.entry_date,
            entry.scripture_ref,
            entry.scripture_translation_code,
            entry.scripture_text,
            entry.observation,
            entry.application,
            entry.prayer,
            entry.created_at,
            entry.updated_at,
          ],
        )

        if (entry.verses.length > 0) {
          await tx.runMany(
            'INSERT INTO entry_scripture_verses (entry_id, book_order_index, chapter_number, verse_number) VALUES (?, ?, ?, ?)',
            entry.verses.map((v) => [id, v.book_order_index, v.chapter, v.verse]),
          )
        }

        const tagIds = await resolveTags(tx, entry.tags, now)
        if (tagIds.length > 0) {
          await tx.runMany(
            'INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)',
            tagIds.map((tagId) => [id, tagId]),
          )
        }
      }

      return { entryCount: backup.entries.length }
    })
  } catch (err) {
    if (err instanceof RestoreError) throw err
    throw new RestoreError(
      'restore',
      'The restore failed and was rolled back; your journal is unchanged.',
      undefined,
      err,
    )
  }
}

/** Convenience one-shot: validate text, then restore. */
export async function restoreBackupFromText(
  db: DbExecutor,
  text: string,
  now?: string,
): Promise<{ entryCount: number }> {
  return restoreJournal(db, parseBackup(text), now)
}
