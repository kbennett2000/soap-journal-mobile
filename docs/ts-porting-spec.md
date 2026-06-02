# soap-journal-mobile — TS Porting Spec

The map for porting soap-journal's server logic into this app's TypeScript. Read with
`schema.md` (the tables) and `architecture.md` (the shape) open.

## Method

- Each Python source maps to a TS target below.
- **Port against the named `_test.py` as the oracle.** For pure-logic modules,
  re-express that test file's cases in Vitest roughly 1:1 — same inputs, same
  accept/reject/parse results. The port is "done" when the equivalent cases pass.
  This is the whole point: CC ports against known-good behavior, not from scratch.
- For data-layer modules the server tests are HTTP-level (FastAPI TestClient) and
  can't run here, but they still *specify* behavior — status-code→error mappings,
  response shapes, filter semantics, ordering, pagination. Mine them for cases and
  re-express as repository-level tests against a temp/in-memory SQLite.
- **Adapt** where Model B, single-user, or SQLite changes things (see Cross-cutting).
  Preserve behavior everywhere else.
- **Do not port:** auth, sessions, admin, users, the FastAPI app, the parsers
  themselves, Alembic. Those stay in the server repo.

## Port map

| # | Python source | TS target | Oracle test | Kind |
|---|---|---|---|---|
| 1 | `core/bible/books.py` | `lib/bible/books.ts` | `core/bible/books_test.py` | pure |
| 2 | `core/references.py` | `lib/bible/references.ts` | `core/references_test.py` | pure |
| 3 | `parsers/schema.py` | `lib/schema/canonical.ts` (Zod) | `parsers/schema_test.py` | pure |
| 4 | `core/errors.py` (ErrorCode) | `lib/db/errors.ts` (+ reuse web `lib/apiError.ts`) | — | support |
| 5 | `cli/load_translation.py` → `load_canonical_translation` | `lib/db/loadTranslation.ts` | `cli/load_translation_test.py` | insert |
| 6 | `api/bible.py` (read paths) | `lib/db/bible.ts` | `api/bible_test.py`, `api/bible_passages_test.py` | repo |
| 7 | `core/entries.py` (`save_entry`) | `lib/db/entries.ts` (save) | `api/entries_test.py` | repo |
| 8 | `core/entries_query.py` + calendar/on-this-day in `api/entries.py` | `lib/db/entries.ts` (read) | `api/entries_retrieval_test.py` | repo |
| 9 | `api/tags.py` + tag get-or-create in `core/entries.py` | `lib/db/tags.ts` | `api/tags_test.py` | repo |

## Cross-cutting adaptations (apply to every relevant port)

- **No `user_id`.** Drop every user-scoping predicate and the cross-user-404 logic.
  One implicit local user.
- **Translation by code, not id.** Entries store `scripture_translation_code`. Where
  the server joins through `scripture_translation_id` to get the code (e.g.
  `_build_response`), just read the column. Where it resolves a translation for save,
  keep the rule: explicit `translation_code`, else first-loaded
  (`ORDER BY loaded_at ASC, id ASC LIMIT 1`).
- **Coordinate linkage (Model B).** `entry_scripture_verses` stores
  `(book_order_index, chapter_number, verse_number)`. Save still reads the chosen
  translation's verses to **snapshot text and validate the range is in-bounds**, but
  the linkage rows come from the parsed reference + the book's `order_index` — no
  lookup to record them. The passage-entries query matches coordinates by
  `(book_order_index, chapter_number)` directly — no join to verses/chapters/books,
  and translation-agnostic.
- **Errors.** Port `ErrorCode` to a TS enum and throw an `ApiError`-shaped error
  (reuse the web app's `lib/apiError.ts`) carrying the same code + message, so the
  ported UI's error handling and `ErrorBoundary` keep working unchanged. Map the
  server's HTTP statuses to codes: 400→`INVALID_REFERENCE`/`INVALID_BOOK`/
  `INVALID_DATE_RANGE`, 404→`TRANSLATION_NOT_FOUND`/`ENTRY_NOT_FOUND`, etc.
- **Async + transactions.** Repositories are async (the plugin is async); keep the
  function signatures the ported hooks expect. `save_entry` must stay atomic
  (parse → snapshot → rebuild `entry_scripture_verses` → rebuild `entry_tags`) inside
  one transaction.
- **Dates as TEXT.** `entry_date` is `YYYY-MM-DD`. On-this-day matches month-day
  (`substr(entry_date,6,5)` or `strftime`); calendar groups by year-month. Timestamps
  are ISO-8601 UTC set in app code on write.

## Per-module notes

**1. books.ts** — the dependency root (2, 3, and coordinate `order_index` all need
it). Port the static 66-book list with `name`, `abbreviation`, `order_index` (1–66),
`testament` ("OT"/"NT"), and the full alias map (the CHANGELOG-added abbreviations and
ordinal forms — "Deu", "1st Samuel", etc.). Port `get_book_by_name` (case-insensitive,
alias-aware). `books_test.py` is the contract for which names resolve.

**2. references.ts** — port `ParsedReference` and `parse_reference_or_raise` (the
API-facing entry point, which promotes the cross-chapter case to its specific
message). Preserve the **exact** accept/reject set: single verse, verse range in one
chapter, whole chapter, abbreviations/aliases, numbered books with/without space,
case-insensitivity, en/em-dash normalization; reject empty, bare book name (with the
"missing a chapter" message), unknown book, reversed/zero ranges, multi-reference
(`;`/`,`), and cross-chapter (with the "not supported in v1" message).
`references_test.py` is the contract.

**3. canonical.ts** — port the Pydantic schema to Zod (already a dependency). The
field shapes are straightforward; the load-bearing part is the **cross-field
validators**, expressed as `.superRefine`: verses numbered 1..N with no gaps/dupes;
headings/footnotes reference an existing verse number; book name canonical with
matching `order_index` and `abbreviation`; exactly 66 books in canonical order. The TS
validator must make the **same accept/reject decisions** as Python — port
`schema_test.py`'s cases. This powers import validation.

**5. loadTranslation.ts** — the shared canonical-insert routine, ported from
`load_canonical_translation`. Sequence unchanged (it's Bible-tables only, untouched by
Model B): delete-existing-by-`code` (cascade clears dependents) → insert translation
→ books → chapters → verses (keep a number→row map) → headings → footnotes (resolve
each `verse_number` to its verse row id within the chapter). Map canonical `copyright`
→ `copyright_notice`; set `loaded_at` on insert. Write it over a minimal **executor
interface** so it runs under both drivers: better-sqlite3 (synchronous, build time)
and the Capacitor plugin (async, runtime import). Simplest seam: an async executor
interface with a thin sync-wrapping adapter for better-sqlite3. `load_translation_test.py`
is the contract for replace-by-code and counts.

**6. bible.ts** — four reader repositories: list translations; translation detail +
book list + per-book chapter counts (one grouped count query); chapter content (verses
+ headings + footnotes-by-verse-id, plus prev/next nav = previous book's max chapter /
next book's first chapter) with testament from books.ts; and `resolve(ref, code)` for
the jump bar. Plus **passage-entries** (Model B: count/list distinct entries in
`entry_scripture_verses` for the book+chapter being read). Keep the server's
fixed-SELECT-count discipline (no N+1). `bible_test.py` / `bible_passages_test.py` are
the contracts.

**7 & 8. entries.ts** — `saveEntry` (POST+PUT pipeline) and the read side (get, list
with filters + ordering + pagination, calendar, on-this-day). Port the filter
machinery from `entries_query.py`: book filter as `EXISTS` against
`entry_scripture_verses` (now by `book_order_index`), tag filter as `EXISTS` against
`entry_tags`+`tags`, date range, and keyword `LIKE` across
title/observation/application/prayer/scripture_text **with the LIKE-wildcard escaping
preserved** (`\` `%` `_`). `display_title` = `title` or `scripture_ref`. Verse-range
validation against the chapter's actual length stays. `entries_test.py` and
`entries_retrieval_test.py` are the contracts.

**9. tags.ts** — list (tags LEFT JOIN entry_tags, count, order by lower(name)) and
autocomplete (prefix on `name_lower`, order by count desc then name, limit 10), minus
user scoping. The get-or-create-on-save logic (case-insensitive lookup, create with
the user's original casing) lives in `saveEntry` but is tag behavior — port it
faithfully; `tags_test.py` covers casing/uniqueness.

## Suggested port order (small, independently reviewable cycles)

Dependency-ordered so each cycle builds only on merged ones:

1. `lib/bible/books.ts` (+ tests) — foundation.
2. `lib/bible/references.ts` (+ tests) — depends on books.
3. `lib/schema/canonical.ts` (+ tests) — depends on books; unblocks import.
4. `lib/db/` connection + migrations (creates the schema from `schema.md`) +
   `lib/db/errors.ts` — foundation for all repositories.
5. `lib/db/loadTranslation.ts` (+ tests) — depends on 3 + 4; also unblocks the
   `build-bible-db` script.
6. `lib/db/bible.ts` reader repositories (+ tests) — depends on 4, plus loaded data.
7. `lib/db/entries.ts` save + read (+ tests) — depends on 1, 2, 4, 6.
8. `lib/db/tags.ts` (+ tests) — depends on 4, 7.

Each cycle ports its module and its oracle tests together, and is done only when those
tests pass — same bar the server's CLAUDE.md sets.
