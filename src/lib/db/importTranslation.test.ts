// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'

import { listTranslations } from './bible'
import { createBetterSqliteExecutor } from './betterSqliteConnection'
import type { DbExecutor } from './executor'
import { ImportError, importTranslationFromText } from './importTranslation'
import { runMigrations } from './migrations'

// Drives the import pipeline by feeding file TEXT directly (no native dialog).
// Builds plain objects -> JSON.stringify, exactly what a picked file contains.

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
})

afterEach(async () => {
  await db.close()
})

/** A full, valid 66-book canonical translation as plain objects (one verse each). */
function plainTranslation({
  code = 'ESV',
  name = 'English Standard Version',
}: { code?: string; name?: string } = {}): unknown {
  return {
    code,
    name,
    language: 'en',
    copyright: '© owner',
    books: ALL_BOOKS.map((spec) => ({
      name: spec.name,
      abbreviation: spec.abbreviation,
      order_index: spec.order_index,
      chapters: [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }],
    })),
  }
}

async function codes(): Promise<string[]> {
  const { translations } = await listTranslations(db)
  return translations.map((t) => t.code)
}

describe('importTranslationFromText', () => {
  it('imports a valid canonical translation and grows the list', async () => {
    const result = await importTranslationFromText(db, JSON.stringify(plainTranslation()))
    expect(result.code).toBe('ESV')
    expect(result.name).toBe('English Standard Version')
    expect(result.counts).toEqual({ books: 66, chapters: 66, verses: 66 })
    expect(await codes()).toContain('ESV')
  })

  it('rejects malformed JSON without writing anything', async () => {
    await expect(importTranslationFromText(db, 'not json {')).rejects.toMatchObject({
      kind: 'parse',
    })
    expect(await codes()).toEqual([])
  })

  it('rejects schema-invalid JSON with validation errors, writing nothing', async () => {
    // Drop the last book (Revelation) → the schema requires all 66 in order.
    const bad = plainTranslation() as { books: unknown[] }
    bad.books = bad.books.slice(0, 65)
    let caught: unknown
    try {
      await importTranslationFromText(db, JSON.stringify(bad))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ImportError)
    expect((caught as ImportError).kind).toBe('validation')
    expect((caught as ImportError).errors?.length).toBeGreaterThan(0)
    expect(await codes()).toEqual([])
  })

  it('replaces (not duplicates) when re-importing an existing code', async () => {
    await importTranslationFromText(db, JSON.stringify(plainTranslation({ name: 'ESV v1' })))
    await importTranslationFromText(db, JSON.stringify(plainTranslation({ name: 'ESV v2' })))

    const { translations } = await listTranslations(db)
    const esv = translations.filter((t) => t.code === 'ESV')
    expect(esv).toHaveLength(1)
    expect(esv[0]!.name).toBe('ESV v2')
  })
})
