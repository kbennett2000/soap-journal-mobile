# CLAUDE.md

Read `docs/` before starting any work. `docs/ts-porting-spec.md` is the source of
truth for porting server logic; `docs/schema.md` defines the database;
`docs/architecture.md` the overall shape; `docs/first-run-and-import.md` and
`docs/backup-and-restore.md` the data lifecycle and portability.

## Project Overview

soap-journal-mobile is an offline, single-user mobile app for SOAP (Scripture,
Observation, Application, Prayer) journaling with a built-in Bible reader. It is a
Capacitor-wrapped React app that reads and writes a local SQLite database on the
device — a standalone companion to the soap-journal LAN server, not synced with it.

## Tech Stack

Pinned to match the soap-journal web frontend so its UI ports in cleanly. Do not bump
React, Tailwind, or React Router majors.

- **Shell:** Capacitor (Android target; iOS deferred — needs macOS).
- **Local DB:** `@capacitor-community/sqlite` 8.1.0 (prebuilt DB copied from assets).
- **UI:** React 18.3.1, TypeScript 5.6.3 (strict), Vite 8.
- **Styling:** Tailwind CSS 3.4.19, PostCSS 8.5.15, autoprefixer 10.5.0.
- **Routing:** React Router 6.30.3.
- **Async/cache:** TanStack Query 5.100.14 (the web app's server-state layer, over SQLite).
- **Validation:** Zod 4.4.3 (canonical-JSON import + backup format).
- **Build-time only:** better-sqlite3 (devDependency) for the prebuilt-Bible script.
- **Backup:** `@capacitor/share` + Capacitor Filesystem (export).
- **Tests:** Vitest 4.1.7, @testing-library/react 16.3.2, happy-dom.

## Architecture

- **Standalone repo**, not a monorepo with the server. Ships no Python; consumes only
  the canonical Bible JSON the server's parsers produce.
- **Capacitor shell + React SPA + one local SQLite file.** The UI is ported from the
  soap-journal web frontend.
- **One database** holding both Bible tables (seeded from a prebuilt asset) and journal
  tables (entries/tags). See `docs/schema.md`.
- **The data seam:** where the web app called HTTP via `lib/api.ts`, this app's
  `lib/db` runs local SQLite. TanStack Query patterns are unchanged.
- Layout:
  - `src/components/` — UI (ported + `BottomTabBar`, import + backup/restore screens)
  - `src/routes/` — page components (no auth/admin pages)
  - `src/hooks/` — data hooks; call `lib/db`
  - `src/lib/db/` — connection, migrations, repositories, shared insert routine, errors
  - `src/lib/bible/` — book list + reference parser (TS ports of the server)
  - `src/lib/schema/` — Zod validators: canonical-JSON (import) + backup format
  - `src/lib/` — theme, storage, apiError, queryClient (ported)
  - `src/types/` — shared TS types
  - `scripts/build-bible-db.ts` — builds the prebuilt Bible asset (better-sqlite3)
  - `assets/` — prebuilt DB + plugin manifest
  - `android/` — native project (committed)
  - `bibles-private/` — gitignored user-supplied copyrighted PDFs/JSONs

## Conventions

- **TypeScript:** `camelCase` for variables/functions; `PascalCase` for components,
  types, and interfaces. No `any` — use `unknown` and narrow. Strict mode on.
- **Imports:** absolute via the `@/` → `src/` alias (set in `tsconfig` +
  `vite.config.ts`). No `../../` chains beyond one level.
- **Files:** one React component per file, named after the component. Tests are
  siblings: `.test.ts` / `.test.tsx`.
- **Data access:** only through `lib/db` repositories — components and hooks never run
  raw SQL. Repositories are async and throw an `ApiError`-shaped error
  (`lib/db/errors`) carrying the same codes as the server, so ported UI error handling
  works unchanged.
- **Database:** set `PRAGMA foreign_keys = ON` on every connection. Schema changes ship
  as a new ordered migration advancing `user_version`; the build script and runtime
  share one migration set. Never change the schema outside a migration.
- **Canonical Bible format** is the contract with the server repo. The Zod schema in
  `lib/schema` mirrors the server's `parsers/schema.py` — keep them in lockstep. Bible
  data is only ever read/written in canonical form.
- **Verse references** are parsed centrally in `lib/bible/references.ts` (the TS port).
  Accept full and abbreviated book names.
- **Entries are self-contained (Model B):** store snapshotted `scripture_text`,
  `scripture_translation_code`, and `(book, chapter, verse)` coordinates. Journal
  tables hold no foreign key into Bible tables.
- **App preferences** (theme, reader font/layout, default translation) live in
  `localStorage` via the ported `lib/theme` / `lib/storage`. SQLite is Bible + journal
  data only.
- **Styling:** Tailwind utilities inline; dark mode via the `dark:` class on `<html>`,
  toggled by the ported theme code. Match the soap-journal tokens copied during the port.
- **Routing:** SPA via React Router; the primary nav is a bottom tab bar
  (Dashboard · Reader · Entries · Calendar · Settings).
- **Ports are verified against the server's `_test.py` files as the oracle** (see
  `docs/ts-porting-spec.md`). A port is not done until its equivalent tests pass.

## Out of Scope for v1

Do not build these unless explicitly asked:

- Auth, login, sessions, accounts, multi-user. Single local user; the device lock is
  the gate. An in-app PIN is deferred.
- Sync or data migration with the LAN server (a separate instance by design).
- Merge-style restore / conflict resolution (restore is replace-only).
- Backing up Bible text or app preferences (backup is journal-only).
- Automatic / scheduled backups; any cloud or remote sync.
- iOS build and packaging (Android is the v1 target; iOS needs a Mac, later).
- Shipping copyrighted translations in the repo or the app (users import their own).
- Reading plans, bookmarks/highlights, audio Bible, commentary, original-language tools.
- Any outbound network call at runtime — the app is fully offline.
- Bumping to React 19 / Tailwind 4 / React Router 7 (pinned to keep the UI port clean).


## Git Workflow

After any code change is complete and verified (tests pass / lint clean /
feature works), do the following without being asked:

1. `git add -A` to stage all changes
2. Commit with a concise conventional-commit message
   (e.g. `feat: add user auth middleware`, `fix: handle empty cart edge case`,
   `refactor: extract validation into shared module`, `docs: update README`)
3. `git push` to push to origin/main

Commit at logical checkpoints — a complete feature, a bug fix, a refactor —
not after every individual file edit. If a task spans multiple commits,
make each commit independently meaningful and atomic.

If `git push` fails (auth, conflict, network), surface the full error to the
user immediately. Do not retry silently or attempt destructive resolutions
(no `--force`, no resetting branches).

Never commit secrets, API keys, .env files, or anything matching .gitignore.


## Engineering Principles

### Tests are required, not optional
- Every new feature, bug fix, or non-trivial change ships with tests.
- For new functionality, prefer test-first: write the test from the spec,
  then implement until it passes.
- A task is not "done" until the relevant tests pass. Do not report completion
  with failing or skipped tests.
- When fixing a bug, first write a test that reproduces the bug (and fails),
  then fix it. This prevents regressions.
- Keep the test suite fast. If a test is slow, isolate it (mark as integration
  or e2e) so the default `test` command stays under 10 seconds for unit tests.

### Tight feedback loops
- Use strict typing everywhere (TypeScript strict mode / Pydantic / Zod —
  whatever the stack supports). Type errors should surface immediately.
- Run lint and typecheck before declaring a task complete.
- Add structured logging at module boundaries from day one. When something
  breaks, logs should narrow the cause in seconds, not minutes.
- If a change requires manual verification (UI, integrations), state exactly
  what to check and how — don't leave it implicit.

### Spec before code for non-trivial work
- For any task touching 3+ files, introducing a new module, or changing a
  contract between components: produce a spec FIRST in plan mode. Do not
  start editing until the user has approved the plan.
- For significant architectural decisions, write a short ADR (Architecture
  Decision Record) in `/docs/adr/` capturing: context, options considered,
  decision, consequences. Reference the ADR in commit messages.
- Read `/docs/` and `/specs/` (if they exist) before starting work. Those
  files describe intent; the code describes implementation. Both matter.

### Taste and restraint
- Prefer the simplest solution that solves the problem. Resist adding
  abstraction, config options, or framework features that aren't justified
  by an actual requirement.
- If a diff is getting large, stop and ask whether the task should be
  decomposed into smaller commits.
- Reuse existing patterns in the codebase before inventing new ones.