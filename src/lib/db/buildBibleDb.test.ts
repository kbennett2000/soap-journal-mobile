// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ALL_BOOKS } from '@/lib/bible/books'
import { CanonicalTranslationSchema } from '@/lib/schema/canonical'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import { buildBibleDb, runBuildCli } from './buildBibleDb'
import { TARGET_USER_VERSION } from './migrations'

// Exercises the build orchestration against synthetic canonical JSONs in a temp
// dir (no real Bible data). Mirrors the server loader's file/CLI cases: valid
// load, missing input, invalid file.

let workDir: string
let inputDir: string
let outputDbPath: string

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'build-bible-db-'))
  inputDir = join(workDir, 'bibles-canonical')
  mkdirSync(inputDir, { recursive: true })
  outputDbPath = join(workDir, 'out', 'soapjournal.db')
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

// A full 66-book minimal canonical translation (1 verse/book), validated so
// defaults are filled — the same validate-then-emit shape the real build uses.
function writeTranslation(code: string, name = code): void {
  const books = Array.from({ length: 66 }, (_, i) => {
    const spec = ALL_BOOKS[i]
    return {
      name: spec.name,
      abbreviation: spec.abbreviation,
      order_index: spec.order_index,
      chapters: [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }],
    }
  })
  const payload = CanonicalTranslationSchema.parse({
    code,
    name,
    language: 'en',
    copyright: `© ${code}`,
    books,
  })
  writeFileSync(join(inputDir, `${code}.json`), JSON.stringify(payload))
}

describe('buildBibleDb — success', () => {
  it('emits an asset with all translations, correct schema, empty journal tables', async () => {
    writeTranslation('AAA')
    writeTranslation('BBB')

    const code = await runBuildCli({ inputDir, outputDbPath })
    expect(code).toBe(0)
    expect(existsSync(outputDbPath)).toBe(true)

    const db = createBetterSqliteExecutor(outputDbPath)
    try {
      const codes = (await db.query<{ code: string }>('SELECT code FROM translations ORDER BY code'))
        .map((r) => r.code)
      expect(codes).toEqual(['AAA', 'BBB'])

      for (const c of codes) {
        const [{ n }] = await db.query<{ n: number }>(
          'SELECT count(*) n FROM books b JOIN translations t ON t.id = b.translation_id WHERE t.code = ?',
          [c],
        )
        expect(n).toBe(66)
      }

      const [{ user_version }] = await db.query<{ user_version: number }>('PRAGMA user_version')
      expect(user_version).toBe(TARGET_USER_VERSION)

      // Journal tables exist and are empty (Bible-only asset).
      for (const table of ['entries', 'tags', 'entry_tags', 'entry_scripture_verses']) {
        const [{ n }] = await db.query<{ n: number }>(`SELECT count(*) n FROM ${table}`)
        expect(n, table).toBe(0)
      }
    } finally {
      await db.close()
    }
  })

  it('is idempotent — re-running produces a fresh asset (no doubling)', async () => {
    writeTranslation('AAA')
    writeTranslation('BBB')

    await buildBibleDb({ inputDir, outputDbPath })
    await buildBibleDb({ inputDir, outputDbPath })

    const db = createBetterSqliteExecutor(outputDbPath)
    try {
      const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM translations')
      expect(n).toBe(2)
      const [{ b }] = await db.query<{ b: number }>('SELECT count(*) b FROM books')
      expect(b).toBe(132)
    } finally {
      await db.close()
    }
  })
})

describe('buildBibleDb — failure modes (write nothing)', () => {
  it('returns 2 when the input dir is missing, writes no asset', async () => {
    const code = await runBuildCli({ inputDir: join(workDir, 'nope'), outputDbPath })
    expect(code).toBe(2)
    expect(existsSync(outputDbPath)).toBe(false)
  })

  it('returns 2 when the input dir has no .json files', async () => {
    const code = await runBuildCli({ inputDir, outputDbPath })
    expect(code).toBe(2)
    expect(existsSync(outputDbPath)).toBe(false)
  })

  it('returns 1 on an invalid file and leaves no asset', async () => {
    writeTranslation('AAA')
    writeFileSync(join(inputDir, 'BAD.json'), '{ not valid json')

    const code = await runBuildCli({ inputDir, outputDbPath })
    expect(code).toBe(1)
    expect(existsSync(outputDbPath)).toBe(false)
  })

  it('returns 1 when a file is valid JSON but invalid canonical, no asset', async () => {
    writeTranslation('AAA')
    // Valid JSON, but zero books — fails the 66-book canonical rule.
    writeFileSync(
      join(inputDir, 'SHORT.json'),
      JSON.stringify({ code: 'SHORT', name: 'Short', language: 'en', copyright: 'x', books: [] }),
    )

    const code = await runBuildCli({ inputDir, outputDbPath })
    expect(code).toBe(1)
    expect(existsSync(outputDbPath)).toBe(false)
  })
})
