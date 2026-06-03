/**
 * Schema migrations.
 *
 * One ordered migration set is the single source of truth for the on-device
 * schema, shared by two callers (docs/first-run-and-import.md):
 *   - runtime: on startup, advance `user_version` forward in place.
 *   - build-bible-db (cycle 5): run the full set on an empty DB to create the
 *     prebuilt asset.
 *
 * Each migration runs inside its own transaction; the `user_version` bump is
 * part of that transaction, so a failed migration rolls back cleanly and never
 * leaves the DB half-migrated. Migrations and docs/schema.md stay in lockstep.
 */

import type { DbExecutor } from './executor'

interface Migration {
  version: number
  up: (tx: DbExecutor) => Promise<void>
}

/**
 * v1 — create every table, index, and constraint in docs/schema.md.
 *
 * Bible tables mirror the server exactly (so the shared insert routine ports
 * directly). Journal tables are Model B: no `user_id`, and the entry↔scripture
 * linkage is canonical coordinates + a translation code, with NO foreign key
 * from journal tables into Bible tables.
 */
const V1_SCHEMA_SQL = `
-- ---- Bible tables (faithful mirror of the server) ------------------------

CREATE TABLE translations (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  language         TEXT NOT NULL,
  copyright_notice TEXT NOT NULL,
  loaded_at        TEXT NOT NULL
);

CREATE TABLE books (
  id             INTEGER PRIMARY KEY,
  translation_id INTEGER NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  abbreviation   TEXT NOT NULL,
  order_index    INTEGER NOT NULL,
  UNIQUE (translation_id, order_index),
  UNIQUE (translation_id, name)
);
CREATE INDEX ix_books_translation ON books(translation_id);

CREATE TABLE chapters (
  id      INTEGER PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  number  INTEGER NOT NULL,
  UNIQUE (book_id, number)
);
CREATE INDEX ix_chapters_book ON chapters(book_id);

CREATE TABLE verses (
  id            INTEGER PRIMARY KEY,
  chapter_id    INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  number        INTEGER NOT NULL,
  text          TEXT NOT NULL,
  is_red_letter INTEGER NOT NULL DEFAULT 0,
  UNIQUE (chapter_id, number)
);
CREATE INDEX ix_verses_chapter ON verses(chapter_id);

CREATE TABLE headings (
  id           INTEGER PRIMARY KEY,
  chapter_id   INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  before_verse INTEGER NOT NULL,
  text         TEXT NOT NULL
);
CREATE INDEX ix_headings_chapter ON headings(chapter_id);

CREATE TABLE footnotes (
  id       INTEGER PRIMARY KEY,
  verse_id INTEGER NOT NULL REFERENCES verses(id) ON DELETE CASCADE,
  text     TEXT NOT NULL
);
CREATE INDEX ix_footnotes_verse ON footnotes(verse_id);

-- ---- Journal tables (single-user, Model B) -------------------------------

CREATE TABLE entries (
  id                         INTEGER PRIMARY KEY,
  title                      TEXT,
  entry_date                 TEXT NOT NULL,
  scripture_ref              TEXT NOT NULL,
  scripture_translation_code TEXT NOT NULL,
  scripture_text             TEXT NOT NULL,
  observation                TEXT NOT NULL DEFAULT '',
  application                TEXT NOT NULL DEFAULT '',
  prayer                     TEXT NOT NULL DEFAULT '',
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);
CREATE INDEX ix_entries_date ON entries(entry_date);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  name_lower TEXT GENERATED ALWAYS AS (lower(name)) STORED NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (name_lower)
);

CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX ix_entry_tags_tag ON entry_tags(tag_id);

CREATE TABLE entry_scripture_verses (
  entry_id         INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  book_order_index INTEGER NOT NULL,
  chapter_number   INTEGER NOT NULL,
  verse_number     INTEGER NOT NULL,
  PRIMARY KEY (entry_id, book_order_index, chapter_number, verse_number)
);
CREATE INDEX ix_entry_scripture_passage
  ON entry_scripture_verses(book_order_index, chapter_number, verse_number);
`

/**
 * v2 — translator's-note metadata + cross-references (lockstep with the server's
 * alembic `4708ebfdc41a`). Forward-only and safe on a POPULATED v1 `footnotes`
 * table: SQLite `ADD COLUMN` permits a column-level CHECK and a constant
 * NOT NULL DEFAULT, and existing rows take the defaults (note fields NULL,
 * ordinal 0). NULL satisfies the `note_type` CHECK. `cross_references` cascades
 * from footnotes/verses/books, so the loader's replace-by-code delete reaches it
 * without extra teardown.
 */
const V2_SCHEMA_SQL = `
ALTER TABLE footnotes ADD COLUMN note_type   TEXT CHECK (note_type IN ('tn','sn','tc','map'));
ALTER TABLE footnotes ADD COLUMN char_offset INTEGER;
ALTER TABLE footnotes ADD COLUMN marker      INTEGER;
ALTER TABLE footnotes ADD COLUMN ordinal     INTEGER NOT NULL DEFAULT 0;

CREATE TABLE cross_references (
  id             INTEGER PRIMARY KEY,
  footnote_id    INTEGER NOT NULL REFERENCES footnotes(id) ON DELETE CASCADE,
  from_verse_id  INTEGER NOT NULL REFERENCES verses(id)    ON DELETE CASCADE,
  to_book_id     INTEGER NOT NULL REFERENCES books(id)     ON DELETE CASCADE,
  to_chapter     INTEGER NOT NULL,
  to_verse_start INTEGER NOT NULL,
  to_verse_end   INTEGER
);
CREATE INDEX ix_cross_references_footnote_id   ON cross_references(footnote_id);
CREATE INDEX ix_cross_references_from_verse_id ON cross_references(from_verse_id);
CREATE INDEX ix_cross_references_to_target     ON cross_references(to_book_id, to_chapter, to_verse_start);
`

/**
 * The ordered migration set. Exported so tests can apply a subset (e.g. v1 only,
 * then forward to v2) to exercise the on-device forward-migration path. Runtime
 * callers use `runMigrations`, not this directly.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (tx) => tx.execScript(V1_SCHEMA_SQL),
  },
  {
    version: 2,
    up: (tx) => tx.execScript(V2_SCHEMA_SQL),
  },
]

/** The schema version this build of the app targets (max migration version). */
export const TARGET_USER_VERSION = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
)

/**
 * Apply every pending migration. Reads `PRAGMA user_version`, then for each
 * migration with a higher version runs it in a transaction and bumps the
 * version. Idempotent: a DB already at the target version runs nothing.
 */
export async function runMigrations(executor: DbExecutor): Promise<void> {
  const rows = await executor.query<{ user_version: number }>('PRAGMA user_version')
  const current = rows[0]?.user_version ?? 0

  const pending = [...MIGRATIONS]
    .sort((a, b) => a.version - b.version)
    .filter((m) => m.version > current)

  for (const migration of pending) {
    await executor.transaction(async (tx) => {
      await migration.up(tx)
      // PRAGMA user_version can't be parameterized; the version is a trusted
      // integer literal. It's transactional, so it rolls back with the migration.
      await tx.execScript(`PRAGMA user_version = ${migration.version};`)
    })
  }
}
