// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createBetterSqliteExecutor } from './betterSqliteConnection'
import type { DbExecutor } from './executor'
import { MIGRATIONS, runMigrations, TARGET_USER_VERSION } from './migrations'

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

describe('migrated schema — table set', () => {
  it('creates exactly the 11 tables from docs/schema.md', async () => {
    expect(await tableNames()).toEqual([
      'books',
      'chapters',
      'cross_references',
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

  it('creates the 11 named indexes', async () => {
    expect(await indexNames()).toEqual([
      'ix_books_translation',
      'ix_chapters_book',
      'ix_cross_references_footnote_id',
      'ix_cross_references_from_verse_id',
      'ix_cross_references_to_target',
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
    expect(user_version).toBe(2)
    expect(user_version).toBe(TARGET_USER_VERSION)
  })

  it('is idempotent — re-running migrates nothing', async () => {
    await runMigrations(db) // second run
    const [{ user_version }] = await db.query<{ user_version: number }>('PRAGMA user_version')
    expect(user_version).toBe(2)
    expect((await tableNames()).length).toBe(11)
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

// ---- v2: note metadata + cross-references (lockstep with server 4708) -------

describe('migration v2 — footnote note columns & cross_references', () => {
  it('adds the four note columns to footnotes (ordinal NOT NULL default 0)', async () => {
    const c = await columns('footnotes')
    expect(Object.keys(c).sort()).toEqual(
      ['char_offset', 'id', 'marker', 'note_type', 'ordinal', 'text', 'verse_id'].sort(),
    )
    expect(c.note_type.notnull).toBe(0)
    expect(c.char_offset.notnull).toBe(0)
    expect(c.marker.notnull).toBe(0)
    expect(c.ordinal.notnull).toBe(1)
    expect(c.ordinal.dflt_value).toBe('0')
  })

  it('cross_references has the expected columns and PK', async () => {
    const c = await columns('cross_references')
    expect(Object.keys(c).sort()).toEqual(
      [
        'footnote_id',
        'from_verse_id',
        'id',
        'to_book_id',
        'to_chapter',
        'to_verse_end',
        'to_verse_start',
      ].sort(),
    )
    expect(c.id.pk).toBe(1)
    expect(c.to_verse_end.notnull).toBe(0)
    for (const col of ['footnote_id', 'from_verse_id', 'to_book_id', 'to_chapter', 'to_verse_start']) {
      expect(c[col].notnull, col).toBe(1)
    }
  })

  // Helper: insert a translation→book→chapter→verse and return the verse id, so
  // footnote/CHECK tests have a real verse to hang off.
  async function seedVerse(): Promise<number> {
    const { lastInsertRowid: tid } = await db.run(
      "INSERT INTO translations (code, name, language, copyright_notice, loaded_at) VALUES ('T', 'T', 'en', 'c', '2026-01-01T00:00:00Z')",
    )
    const { lastInsertRowid: bid } = await db.run(
      'INSERT INTO books (translation_id, name, abbreviation, order_index) VALUES (?, ?, ?, ?)',
      [tid, 'Genesis', 'Gen', 1],
    )
    const { lastInsertRowid: cid } = await db.run(
      'INSERT INTO chapters (book_id, number) VALUES (?, 1)',
      [bid],
    )
    const { lastInsertRowid: vid } = await db.run(
      'INSERT INTO verses (chapter_id, number, text) VALUES (?, 1, ?)',
      [cid, 'In the beginning'],
    )
    return vid
  }

  it('accepts the four valid note types and NULL', async () => {
    const vid = await seedVerse()
    for (const nt of ['tn', 'sn', 'tc', 'map']) {
      await db.run('INSERT INTO footnotes (verse_id, text, note_type) VALUES (?, ?, ?)', [
        vid,
        'x',
        nt,
      ])
    }
    await db.run('INSERT INTO footnotes (verse_id, text, note_type) VALUES (?, ?, NULL)', [vid, 'x'])
    const [{ n }] = await db.query<{ n: number }>('SELECT count(*) n FROM footnotes')
    expect(n).toBe(5)
  })

  it('rejects an invalid note_type (CHECK)', async () => {
    const vid = await seedVerse()
    await expect(
      db.run('INSERT INTO footnotes (verse_id, text, note_type) VALUES (?, ?, ?)', [vid, 'x', 'xx']),
    ).rejects.toThrow()
  })

  it('defaults ordinal to 0 when unspecified', async () => {
    const vid = await seedVerse()
    const { lastInsertRowid: fid } = await db.run(
      'INSERT INTO footnotes (verse_id, text) VALUES (?, ?)',
      [vid, 'plain'],
    )
    const [{ ordinal }] = await db.query<{ ordinal: number }>(
      'SELECT ordinal FROM footnotes WHERE id = ?',
      [fid],
    )
    expect(ordinal).toBe(0)
  })

  it('forward-migrates a populated v1 footnotes table, preserving rows', async () => {
    // A fresh DB taken to v1 ONLY, then populated with a v1-shape footnote.
    const v1 = createBetterSqliteExecutor(':memory:')
    try {
      await v1.transaction(async (tx) => {
        await MIGRATIONS[0].up(tx)
        await tx.execScript('PRAGMA user_version = 1;')
      })
      const { lastInsertRowid: tid } = await v1.run(
        "INSERT INTO translations (code, name, language, copyright_notice, loaded_at) VALUES ('T', 'T', 'en', 'c', '2026-01-01T00:00:00Z')",
      )
      const { lastInsertRowid: bid } = await v1.run(
        'INSERT INTO books (translation_id, name, abbreviation, order_index) VALUES (?, ?, ?, ?)',
        [tid, 'Genesis', 'Gen', 1],
      )
      const { lastInsertRowid: cid } = await v1.run(
        'INSERT INTO chapters (book_id, number) VALUES (?, 1)',
        [bid],
      )
      const { lastInsertRowid: vid } = await v1.run(
        'INSERT INTO verses (chapter_id, number, text) VALUES (?, 1, ?)',
        [cid, 'In the beginning'],
      )
      await v1.run('INSERT INTO footnotes (verse_id, text) VALUES (?, ?)', [vid, 'a footnote'])

      // Forward-migrate v1 -> v2 in place.
      await runMigrations(v1)

      const [{ user_version }] = await v1.query<{ user_version: number }>('PRAGMA user_version')
      expect(user_version).toBe(2)
      // The existing footnote survives, with the new columns defaulted.
      const [fn] = await v1.query<{ text: string; note_type: string | null; ordinal: number }>(
        'SELECT text, note_type, ordinal FROM footnotes',
      )
      expect(fn.text).toBe('a footnote')
      expect(fn.note_type).toBeNull()
      expect(fn.ordinal).toBe(0)
      // And cross_references now exists.
      const [{ n }] = await v1.query<{ n: number }>(
        "SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='cross_references'",
      )
      expect(n).toBe(1)
    } finally {
      await v1.close()
    }
  })
})
