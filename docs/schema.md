# soap-journal-mobile — Database Schema

The single source of truth for the on-device SQLite schema. **Both** the build-time
`build-bible-db` script (better-sqlite3) and the runtime migration runner derive from
this. Keep it and the migrations in lockstep.

## Conventions

- **Integer PKs** (`INTEGER PRIMARY KEY` = SQLite rowid alias).
- **Dates as TEXT, ISO-8601.** `entry_date` is `YYYY-MM-DD`; timestamps are full
  ISO-8601 UTC. This is the standard SQLite date convention and makes month/day
  matching (on-this-day) a simple `substr`/`strftime`.
- **Booleans as INTEGER** 0/1.
- **Foreign keys must be enabled per connection:** `PRAGMA foreign_keys = ON;`
  SQLite defaults this OFF (the server's loader notes the same gotcha). The
  `lib/db` connection layer sets it on every open.
- **Schema version via `PRAGMA user_version`.** One ordered migration set is the
  source of truth; the build script applies it to create all tables, then populates
  Bible data; the shipped asset carries the current `user_version` with Bible rows
  populated and journal tables empty. First launch just copies the asset (versions
  match, no migration runs); later releases add forward migrations.

## Bible tables — faithful mirror of the server

These match soap-journal's server tables exactly (column names, constraints,
relationships), so the shared canonical-insert routine ports directly from the
server's `load_canonical_translation`. Read-mostly: seeded at build time, extended by
import.

```sql
CREATE TABLE translations (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,        -- e.g. "BSB"
  name             TEXT NOT NULL,
  language         TEXT NOT NULL,
  copyright_notice TEXT NOT NULL,               -- maps from canonical JSON `copyright`
  loaded_at        TEXT NOT NULL                -- ISO-8601 UTC, set at insert
);

CREATE TABLE books (
  id             INTEGER PRIMARY KEY,
  translation_id INTEGER NOT NULL REFERENCES translations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  abbreviation   TEXT NOT NULL,
  order_index    INTEGER NOT NULL,              -- 1..66 canonical order
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
```

Insert order for the shared routine: translation → books → chapters → verses →
headings → footnotes. Map the canonical JSON `copyright` field to `copyright_notice`;
set `loaded_at` to now at insert. (Replace-by-code on re-import: delete the existing
translation by `code` and re-insert; `ON DELETE CASCADE` clears dependents. Because
journal tables hold no FK into Bible tables — see below — re-import never touches
journal integrity.)

## Journal tables — adapted for single-user, import-resilient

Two deliberate departures from the server: **no `user_id`** anywhere (one implicit
local user; the device lock is the gate), and the entry↔scripture linkage is stored
as **canonical coordinates and a translation code**, not as FKs into the Bible tables
(Model B — see "Decision to confirm").

```sql
CREATE TABLE entries (
  id                         INTEGER PRIMARY KEY,
  title                      TEXT,                       -- nullable; auto-derived from ref if blank
  entry_date                 TEXT NOT NULL,              -- ISO-8601 date
  scripture_ref              TEXT NOT NULL,              -- canonical string, e.g. "John 3:16-21"
  scripture_translation_code TEXT NOT NULL,              -- e.g. "ESV"; denormalized, stable across re-import
  scripture_text             TEXT NOT NULL,              -- snapshot of the verse text at creation
  observation                TEXT NOT NULL DEFAULT '',
  application                TEXT NOT NULL DEFAULT '',
  prayer                     TEXT NOT NULL DEFAULT '',
  created_at                 TEXT NOT NULL,              -- ISO-8601 UTC
  updated_at                 TEXT NOT NULL
);
CREATE INDEX ix_entries_date ON entries(entry_date);

CREATE TABLE tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  name_lower TEXT GENERATED ALWAYS AS (lower(name)) STORED NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (name_lower)                                    -- globally unique (single user)
);

CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)    ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX ix_entry_tags_tag ON entry_tags(tag_id);

CREATE TABLE entry_scripture_verses (
  entry_id         INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  book_order_index INTEGER NOT NULL,                     -- 1..66, canonical (translation-agnostic)
  chapter_number   INTEGER NOT NULL,
  verse_number     INTEGER NOT NULL,
  PRIMARY KEY (entry_id, book_order_index, chapter_number, verse_number)
);
CREATE INDEX ix_entry_scripture_passage
  ON entry_scripture_verses(book_order_index, chapter_number, verse_number);
```

Notes:
- `name_lower` is a STORED generated column (SQLite ≥ 3.31; the plugin's SQLite is
  well above this), mirroring the server's persisted computed column — keeps original
  casing on `name`, enforces case-insensitive uniqueness. If the plugin ever balks at
  generated columns, the fallback is to set `name_lower` explicitly on insert.
- The reference parser (TS port of `core/references.py`) already yields
  `(book, chapter, start_verse, end_verse)`, so `entry_scripture_verses` rows are
  written **directly from the parsed reference** — no Bible-table lookup needed to
  record them. The book's canonical `order_index` comes from the books list
  (TS port of `core/bible/books.py`).

## How the features map to this schema

- **Reader chapter view:** translations → books → chapters → verses (+ headings,
  footnotes). Bible tables only.
- **Entry create from a verse:** snapshot `scripture_text`, store `scripture_ref` +
  `scripture_translation_code`, and one `entry_scripture_verses` row per verse in the
  range.
- **"Entries on this passage" badge:** count distinct `entry_id` in
  `entry_scripture_verses` matching the book/chapter being read. Coordinate-based, so
  it surfaces entries journaled in **any** translation (journal John 3:16 in ESV → the
  badge shows when reading John 3:16 in KJV).
- **Book / tag / date filters & keyword search:** `EXISTS` against
  `entry_scripture_verses` (book) and `entry_tags`+`tags` (tag), `entry_date`
  range, and `LIKE` over the entry text columns — the same shapes as the server's
  `entries_query.py`, minus the `user_id` predicate.
- **On this day:** match month-day of `entry_date` across years. A scan is fine at
  single-user scale (same rationale the server gives for LIKE search).
- **Entry display when its translation isn't installed** (e.g. after restoring a
  backup before re-importing ESV): `scripture_text` still shows the text and
  `scripture_translation_code` labels it. Entries are fully self-contained.

## Dropped from the server

- **Tables:** `users`, `sessions`, `settings` (no auth, no admin-toggleable runtime
  settings). App preferences (theme, reader font/layout/last-position) stay in the
  WebView's `localStorage` via the ported `lib/theme`/`lib/storage` code — SQLite is
  for Bible + journal data only.
- **Columns:** `user_id` on `entries` and `tags`; the entries→translations FK and the
  entry→verse FK linkage (replaced by the code + coordinates above).

## Migrations & versioning

1. Migration `v1` (one ordered set) creates every table above.
2. `build-bible-db` runs migration `v1` on an empty DB, inserts the 13 public-domain
   translations via the shared routine, sets `user_version = 1`, and emits the asset.
   Journal tables ship empty.
3. First launch: if no working DB exists in app storage, copy the asset in. Versions
   match → no migration runs. (File existence is the copy guard; never re-copy.)
4. Future schema changes ship as migrations `v2`, `v3`, … advancing `user_version`
   in place. User data is never clobbered.
5. Adding more bundled translations in a later release = an in-app insert via the
   shared routine, **not** an asset re-copy.

## Decision to confirm

**Model B (recommended, reflected above) vs Model A (server-faithful).**

- **Model A** would mirror the server precisely: `entries.scripture_translation_id`
  as an FK (`ON DELETE RESTRICT`) and `entry_scripture_verses` linking `verse_id`.
- **Model B** (above) stores `scripture_translation_code` (stable text) and links by
  canonical `(book_order_index, chapter, verse)` coordinates, with **no FK from
  journal tables into Bible tables**.

Why I recommend B for the phone:
1. **Re-import safety.** You'll re-parse and re-import your own PDFs (ESV/NLT/NKJV),
   possibly repeatedly. Replace-by-code deletes and re-inserts verse rows with new
   ids; Model A would orphan entry linkages (or, like the server's RESTRICT, simply
   forbid re-importing a translation you've journaled in). Model B is immune —
   coordinates and the code are stable.
2. **Cross-translation cross-references.** Coordinate-based linkage makes the passage
   badge translation-agnostic, which is the *right* behavior for a multi-translation
   reader.
3. **Less porting work, not more.** The reference parser already produces the
   coordinates, so entry-save writes them directly with no Bible-table lookup, and the
   passage query needs no join to `verses`.

One honest consequence: Model B decouples journal from Bible tables, so the
join-necessity argument behind the confirmed **one-database** choice no longer
strictly applies. One DB still stands — for operational simplicity (single
connection, file, and migration path) and single-file backup — but now as a
simplicity choice rather than a hard requirement.

If you'd rather stay server-faithful (Model A), the change is localized to `entries`
and `entry_scripture_verses` plus the entry-save/passage queries; say so and I'll swap
it before the porting spec builds on this.
