// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import type { DbExecutor } from './executor'
import { runMigrations, TARGET_USER_VERSION } from './migrations'

// No server oracle for this cycle — docs/schema.md is the spec. These tests
// assert the migrated schema matches it: table set, named indexes, the
// generated column, FK enforcement + cascade, defaults, and user_version.

let db: DbExecutor

beforeEach(async () => {
  db = createBetterSqliteExecutor(':memory:')
  await runMigrations(db)
})

afterEach(async () => {
  await db.close()
})

async function tableNames(): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )
  return rows.map((r) => r.name)
}

async function indexNames(): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%' ORDER BY name",
  )
  return rows.map((r) => r.name)
}

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

async function columns(table: string): Promise<Record<string, ColumnInfo>> {
  const rows = await db.query<ColumnInfo>(`PRAGMA table_info(${table})`)
  return Object.fromEntries(rows.map((c) => [c.name, c]))
}

describe('migration v1 — table set', () => {
  it('creates exactly the 10 tables from docs/schema.md', async () => {
    expect(await tableNames()).toEqual([
      'books',
      'chapters',
      'entries',
      'entry_scripture_verses',
      'entry_tags',
      'footnotes',
      'headings',
      'tags',
      'translations',
      'verses',
    ])
  })

  it('creates the 8 named indexes', async () => {
    expect(await indexNames()).toEqual([
      'ix_books_translation',
      'ix_chapters_book',
      'ix_entries_date',
      'ix_entry_scripture_passage',
      'ix_entry_tags_tag',
      'ix_footnotes_verse',
      'ix_headings_chapter',
      'ix_verses_chapter',
    ])
  })

  it('sets user_version to the target', async () => {
    const [{ user_version }] = await db.query<{ user_version: number }>('PRAGMA user_version')
    expect(user_version).toBe(1)
    expect(user_version).toBe(TARGET_USER_VERSION)
  })

  it('is idempotent — re-running migrates nothing', async () => {
    await runMigrations(db) // second run
    const [{ user_version }] = await db.query<{ user_version: number }>('PRAGMA user_version')
    expect(user_version).toBe(1)
    expect((await tableNames()).length).toBe(10)
  })
})

describe('migration v1 — columns & constraints', () => {
  it('translations has the expected columns', async () => {
    const c = await columns('translations')
    expect(Object.keys(c).sort()).toEqual(
      ['code', 'copyright_notice', 'id', 'language', 'loaded_at', 'name'].sort(),
    )
    expect(c.id.pk).toBe(1)
    expect(c.code.notnull).toBe(1)
    expect(c.copyright_notice.notnull).toBe(1)
  })

  it('verses.is_red_letter defaults to 0', async () => {
    const c = await columns('verses')
    expect(c.is_red_letter.notnull).toBe(1)
    expect(c.is_red_letter.dflt_value).toBe('0')
  })

  it("entries text fields default to '' and title is nullable", async () => {
    const c = await columns('entries')
    expect(c.title.notnull).toBe(0)
    for (const field of ['observation', 'application', 'prayer']) {
      expect(c[field].notnull, field).toBe(1)
      expect(c[field].dflt_value, field).toBe("''")
    }
  })

  it('entry_scripture_verses has the 4-column composite primary key', async () => {
    const c = await columns('entry_scripture_verses')
    const pkOrder = Object.values(c)
      .filter((col) => col.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((col) => col.name)
    expect(pkOrder).toEqual([
      'entry_id',
      'book_order_index',
      'chapter_number',
      'verse_number',
    ])
  })
})

describe('migration v1 — generated column (tags.name_lower)', () => {
  it('derives name_lower as lower(name)', async () => {
    const { lastInsertRowid } = await db.run(
      "INSERT INTO tags (name, created_at) VALUES ('Hello', '2026-01-01T00:00:00Z')",
    )
    const [{ name_lower }] = await db.query<{ name_lower: string }>(
      'SELECT name_lower FROM tags WHERE id = ?',
      [lastInsertRowid],
    )
    expect(name_lower).toBe('hello')
  })

  it('enforces case-insensitive uniqueness via UNIQUE(name_lower)', async () => {
    await db.run("INSERT INTO tags (name, created_at) VALUES ('Hello', '2026-01-01T00:00:00Z')")
    await expect(
      db.run("INSERT INTO tags (name, created_at) VALUES ('hello', '2026-01-01T00:00:00Z')"),
    ).rejects.toThrow()
  })
})

describe('migration v1 — foreign keys', () => {
  it('has foreign_keys enforcement enabled', async () => {
    const [{ foreign_keys }] = await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(foreign_keys).toBe(1)
  })

  it('rejects a child row with no matching parent', async () => {
    await expect(
      db.run(
        "INSERT INTO books (translation_id, name, abbreviation, order_index) VALUES (999, 'Genesis', 'Gen', 1)",
      ),
    ).rejects.toThrow()
  })

  it('cascades deletes from translations down to books', async () => {
    const { lastInsertRowid: tid } = await db.run(
      "INSERT INTO translations (code, name, language, copyright_notice, loaded_at) VALUES ('T', 'T', 'en', 'c', '2026-01-01T00:00:00Z')",
    )
    await db.run(
      'INSERT INTO books (translation_id, name, abbreviation, order_index) VALUES (?, ?, ?, ?)',
      [tid, 'Genesis', 'Gen', 1],
    )
    await db.run('DELETE FROM translations WHERE id = ?', [tid])
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM books')
    expect(n).toBe(0)
  })
})
