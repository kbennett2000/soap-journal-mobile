// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { validateBackup } from './backup'

const validEntry = {
  title: null,
  entry_date: '2026-05-20',
  scripture_ref: 'John 3:16',
  scripture_translation_code: 'ESV',
  scripture_text: 'For God so loved…',
  observation: '',
  application: '',
  prayer: '',
  created_at: '2026-05-20T08:12:00.000Z',
  updated_at: '2026-05-20T08:12:00.000Z',
  verses: [{ book_order_index: 43, chapter: 3, verse: 16 }],
  tags: ['faith', 'salvation'],
}

const validBackup = {
  format: 'soap-journal-backup',
  version: 1,
  exported_at: '2026-06-02T14:00:00.000Z',
  entries: [validEntry],
}

describe('validateBackup', () => {
  it('accepts a well-formed backup', () => {
    const result = validateBackup(validBackup)
    expect(result.success).toBe(true)
  })

  it('accepts an empty entries list', () => {
    expect(validateBackup({ ...validBackup, entries: [] }).success).toBe(true)
  })

  it('rejects a wrong format string', () => {
    expect(validateBackup({ ...validBackup, format: 'something-else' }).success).toBe(false)
  })

  it('rejects an unknown version', () => {
    expect(validateBackup({ ...validBackup, version: 2 }).success).toBe(false)
  })

  it('rejects an entry missing a required field', () => {
    const { created_at, ...withoutCreatedAt } = validEntry
    void created_at
    expect(
      validateBackup({ ...validBackup, entries: [withoutCreatedAt] }).success,
    ).toBe(false)
  })

  it('rejects unknown top-level keys (strict)', () => {
    expect(validateBackup({ ...validBackup, extra: true }).success).toBe(false)
  })

  it('rejects an unknown key on a verse coordinate (strict)', () => {
    const badVerse = { ...validEntry, verses: [{ book_order_index: 43, chapter: 3, verse: 16, x: 1 }] }
    expect(validateBackup({ ...validBackup, entries: [badVerse] }).success).toBe(false)
  })
})
