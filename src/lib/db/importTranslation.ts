/**
 * Runtime "import a translation" pipeline: a picked file's text -> the on-device DB.
 *
 * The single seam the Settings import UI calls. Pure logic + one DB write, no
 * React: parse JSON -> validate against the canonical schema -> load. Validation
 * runs entirely BEFORE any write (validate-before-load), so a malformed or
 * schema-invalid file never partially loads. The insert is transactional and
 * replace-by-code (see `loadTranslation`).
 *
 * Each failure mode is surfaced distinctly via `ImportError.kind` so the UI can
 * tell "not JSON" from "doesn't match the format" from "couldn't write".
 */

import { validateCanonicalTranslation } from '@/lib/schema/canonical'

import type { DbExecutor } from './executor'
import { loadTranslation, type TranslationCounts } from './loadTranslation'

export type ImportErrorKind = 'parse' | 'validation' | 'insert'

export class ImportError extends Error {
  readonly kind: ImportErrorKind
  /** Per-field validation messages (only for `kind === 'validation'`). */
  readonly errors?: string[]
  /** The underlying error, when this wraps one (e.g. a DB failure). */
  readonly cause?: unknown

  constructor(kind: ImportErrorKind, message: string, errors?: string[], cause?: unknown) {
    super(message)
    this.name = 'ImportError'
    this.kind = kind
    this.errors = errors
    this.cause = cause
  }
}

export interface ImportResult {
  code: string
  name: string
  counts: TranslationCounts
}

/**
 * Import a translation from raw file text. Throws an `ImportError` (never a bare
 * Error) for any failure; on the parse/validation paths nothing is written.
 */
export async function importTranslationFromText(
  db: DbExecutor,
  text: string,
): Promise<ImportResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ImportError('parse', "That file isn't valid JSON.")
  }

  const result = validateCanonicalTranslation(parsed)
  if (!result.success) {
    throw new ImportError(
      'validation',
      "This file isn't a valid canonical translation.",
      result.errors,
    )
  }

  try {
    const counts = await loadTranslation(db, result.data)
    return { code: result.data.code, name: result.data.name, counts }
  } catch (err) {
    throw new ImportError(
      'insert',
      'Could not save the translation to the database.',
      undefined,
      err,
    )
  }
}
