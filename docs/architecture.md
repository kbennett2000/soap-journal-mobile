# soap-journal-mobile — Architecture

Design doc. Read once to understand the shape; the schema, porting spec, and
first-run/import specs build on this. Companion to `CLAUDE.md` (which carries the
day-to-day rules).

## What this is

An offline, single-user mobile app for SOAP Bible journaling and reading. It is a
**port of the soap-journal web frontend** wrapped in a native shell, reading and
writing a **local SQLite database on the device**. No server, no network, no auth.
A second, independent instance of the experience — not synced with the LAN server,
by design.

## Relationship to soap-journal (the boundary)

The boundary follows the data pipeline already built in the server repo:

- **soap-journal produces** validated canonical Bible JSON (its parsers + the new
  `build-translation` command). The canonical JSON schema is the contract.
- **This app consumes** that JSON: 13 public-domain translations are baked in at
  build time; copyrighted ones (ESV/NLT/NKJV) are imported at runtime from JSON
  the user generates on their own computer.

No Python, no FastAPI, no SQLAlchemy, no Alembic, no parsers ship in this repo.
The only thing that crosses the boundary is canonical JSON.

## High-level shape

```
┌─────────────────────────────────────────────┐
│ Capacitor native shell (Android; iOS later)  │
│  ┌────────────────────────────────────────┐  │
│  │ React 18 SPA (ported soap-journal UI)   │  │
│  │   routes / components / hooks           │  │
│  │            │ TanStack Query             │  │
│  │            ▼                             │  │
│  │   lib/db repositories  ◄── the seam     │  │
│  └────────────┬────────────────────────────┘  │
│               │ @capacitor-community/sqlite    │
│               ▼                                │
│        local SQLite (working DB)               │
└─────────────────────────────────────────────┘
```

UI patterns (fetching, caching, routing, theming) carry over from the web app
unchanged. The only structural swap is the data layer: where the web app's
`lib/api.ts` called HTTP, this app's `lib/db` runs local SQLite queries.

## Data: one SQLite database

**One database file**, not two. It holds both:

- **Bible tables** (translations, books, chapters, verses, headings, footnotes) —
  read-mostly, seeded from the prebuilt asset and extended by import.
- **Journal tables** (entries, tags, and their junctions) — read-write, the user's
  data.

Why one file and not separate bibles/journal DBs: the cross-reference feature
("N entries on this passage") and entry filtering join journal rows to verse rows.
One file means ordinary SQL joins; separate files would force `ATTACH` or
in-app joins, which the plugin may not cleanly support. Backup/restore is then a
single file. (See the schema doc for the table definitions — the same schema is
the single source of truth for both the build script and the runtime migrations.)

## Data flow

```
BUILD TIME  (your computer, Node — better-sqlite3, a devDependency)
  13 public-domain canonical JSONs ─▶ build-bible-db script ─▶ bibles.db
                                                               (shipped as an app asset)

FIRST LAUNCH  (device)
  bibles.db asset ──copy once──▶ working DB in app storage
                                   └─ migrations add the journal tables (entries/tags)

RUNTIME  (device)
  UI ──TanStack Query──▶ lib/db repositories ──SQL──▶ working DB
        reads:  bible text, entry list/detail, search, filter, tags, on-this-day
        writes: entry + tag CRUD

IMPORT  (device, optional)
  user JSON (e.g. ESV) ─▶ TS canonical-schema validator ─▶ shared insert routine ─▶ working DB
                                                            (same logic as build time)
```

**Versioning, so updates never clobber user data.** The prebuilt `bibles.db` asset
is copied into app storage exactly once (guarded on a "already initialized" check)
and thereafter **never overwritten**. The asset ships with a baseline
`PRAGMA user_version`; the runtime migration runner advances from there, adding the
journal tables on first launch and applying any later schema changes in place.
Adding more bundled translations in a future release is an **in-app insert** via the
shared routine below — not a re-copy of the asset. The working DB is the only thing
that needs backing up.

## The shared canonical-insert routine

Inserting a canonical translation into the bible tables happens in two contexts —
build time (better-sqlite3) and runtime import (the Capacitor plugin). The **insert
logic is written once** (the sequence of inserts: translation → books → chapters →
verses → headings → footnotes, mirroring the server's loader) and parameterized over
a minimal executor interface so the same code runs under both drivers. This is the
mobile analogue of the server's `load_canonical_translation`, and it is what makes
seeding and import the same path.

## Reads: TanStack Query over SQLite (the seam)

`lib/db/` exposes repository functions — `getChapter(translation, book, chapter)`,
`listEntries(filters, page)`, `getEntry(id)`, `listTags()`, `onThisDay(date)`,
`passageEntryCount(...)`, etc. Hooks wrap them in `useQuery`/`useMutation` exactly as
the web app wrapped HTTP calls. Components do not change. This single seam is why the
UI copies over wholesale.

## Writes

Entry and tag create/update/delete go through repository mutations that write to
SQLite inside a transaction, then invalidate the relevant TanStack Query keys — same
cache-invalidation pattern the web app already uses.

## Import (user-supplied translations)

A Settings/Library screen offers "Import translation": pick a `.json` file → validate
it against the canonical schema (the TS port of `parsers/schema.py`) → if valid, run
the shared insert routine → side-by-side comparison lights up, identical to the
server. Invalid files are rejected with the validation error and nothing is written.
No copyrighted text ever lives in this repo or the shipped app — each person supplies
their own JSON, the same posture the server takes.

## Navigation & mobile UI deltas

The web app's top-of-page navigation becomes a **bottom tab bar** (thumb-reachable):
Dashboard · Reader · Entries · Calendar · Settings. React Router stays; only the nav
chrome changes. Mobile-specific polish on top of the wholesale UI copy:

- Safe-area insets for notches/home indicators via CSS `env(safe-area-inset-*)`.
- Status-bar styling that follows the light/dark theme (Capacitor StatusBar).
- Touch targets and tap-vs-hover affordances (the web reader's click-verse-to-journal
  flow maps directly to tap).

## Removed from the web app

Auth/login, sessions, the admin panel, open-registration, and all multi-user concerns
are dropped — this is a single user on their own phone, and the device lock is the
gate. The data layer assumes one implicit local user; no `user_id` scoping is needed
on journal tables.

## Project structure

Mirror soap-journal's frontend layout so ported files land in familiar places, plus
the mobile-specific additions:

```
src/
  components/        # ported, + BottomTabBar, ImportTranslation
  routes/            # ported page components (auth/admin pages removed)
  hooks/             # ported; data hooks now call lib/db
  lib/
    db/              # NEW: connection, migrations, repositories, shared insert routine
    bible/           # ported books list + reference parser (TS port)
    schema/          # NEW: TS canonical-JSON validator (port of parsers/schema.py)
    theme.ts ...     # ported
  types/             # shared TS types
scripts/
  build-bible-db.ts  # NEW: 13 JSONs -> bibles.db (better-sqlite3, build time)
assets/              # prebuilt bibles.db + plugin manifest (per plugin convention)
android/             # native project (committed)
bibles-private/      # gitignored: user-supplied ESV/NLT/NKJV JSONs
```

The `@/` → `src/` import alias matches soap-journal and is added to `tsconfig` and
`vite.config.ts` during the UI-port cycle.

## Open decisions to confirm

Three calls I made here to keep v1 coherent — confirm or redirect before I write the
schema on top of them:

1. **One database file** (bible + journal together), not separate bibles/journal DBs.
   Chosen for join-ability and single-file backup.
2. **No auth in v1.** Device lock is the gate; an optional in-app PIN is a deferred
   future item, not v1.
3. **Bottom tab bar** as the primary nav (Dashboard · Reader · Entries · Calendar ·
   Settings), replacing the web top nav.
