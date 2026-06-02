# soap-journal-mobile — First-Run & Import

How the on-device database comes to life, stays alive across app updates, and grows
when you import a translation. Read with `schema.md` (tables + migration model) and
`architecture.md` (the data flow).

> **Plugin API note (verified against `@capacitor-community/sqlite` v8.1.0 source,
> cycles 5b + 10):**
> - Asset folder: **`public/assets/databases/`** (Vite copies `public/` → `dist/`;
>   `cap sync` lands it in the Android assets). The native `copyFromAssets` enumerates
>   that folder directly — **no `databases.json` is needed on Android** (that manifest is
>   only the web/electron path).
> - Asset format: a **plain `.db` file** (`soapjournal.db`). The plugin does NOT use gzip;
>   its only compressed option is a `.zip` archive, which we don't use.
> - Name contract: the plugin appends `SQLite` before `.db` (`addSQLiteSuffix`), so the
>   asset `soapjournal.db` is opened by the app as `createConnection("soapjournal")`
>   (stored internally as `soapjournalSQLite.db`).
> - `copyFromAssets(overwrite: false)` is the first-launch guard — it copies only when no
>   working DB exists, so app updates never clobber user data.

## The three moments

1. **Fresh install** — copy the prebuilt Bible DB in, run migrations (a no-op at v1).
2. **App update** — never re-copy; run any new migrations forward in place.
3. **Import** — validate a user-supplied canonical JSON, then insert it.

Journal data (entries, tags) is created and owned entirely on-device and is **never**
touched by 1 or 3 (Model B decoupling). The only thing that must be protected across
updates is the working DB file.

## Where the database lives

One logical database (call it `soapjournal`) at the plugin's managed database
location in app-private storage. It is the single file that holds everything; it is
also the single thing worth backing up.

## First launch: copy, then migrate

```
on app startup, before any repository call (see src/lib/db/appDb.ts):
  1. copyFromAssets(overwrite: false)   # copies the prebuilt DB IFF none exists — first
                                        #   (must precede opening the connection)
  2. createConnection("soapjournal") + open   # reuse via isConnection/retrieveConnection
  3. PRAGMA foreign_keys = ON           # SQLite defaults this OFF; per connection
  4. run the migration runner (below)   # no-op when the asset is at the target user_version
```

- **`copyFromAssets` with `overwrite: false`** is the first-launch guard *and* the
  update-safety guard in one: it copies the asset only when no working DB exists. On
  every later launch (DB present) it no-ops, so user data is never clobbered.
- The prebuilt asset ships at the current `user_version` with Bible rows populated and
  journal tables empty (per `schema.md`). On a fresh install the runner sees
  `user_version == target` and runs nothing.
- **Failure handling:** if the asset is missing or the copy fails, fail loudly with a
  clear message — do **not** silently fall through to creating an empty database (that
  would strand the user with no Bible text and mask a build error). Migration failure
  rolls back and surfaces; never leave the DB half-migrated.

## App updates

- **Schema changes** ship as new migrations (`v2`, `v3`, …). On update, the copy
  no-ops, the runner advances `user_version` in place. User data preserved.
- **Adding bundled translations in a later release** (post-v1): a fresh install gets
  them via the rebuilt asset; existing installs get them by shipping the new
  translation(s) as a small canonical-JSON *delta* asset plus a migration that inserts
  them via the shared routine (idempotent — skip any `code` already present). The delta
  asset can be dropped a release later once the prebuilt DB carries it. **Not v1
  scope** — v1 has exactly one bundled set — but the migration runner is built general
  enough to support it.

## The migration runner

A single ordered list of `{ version, up(executor) }` migrations in `lib/db/migrations`
is the source of truth, and it is shared:

- **Runtime:** on startup, read `PRAGMA user_version`; for each migration with a
  higher version, run `up` inside a transaction and bump `user_version`.
- **Build time:** `build-bible-db` applies the *entire* list to an empty DB to create
  all tables, then inserts the 13 translations and writes the asset. Because the build
  always runs the full set, the asset is always at the current target version — so
  fresh installs never migrate and existing installs migrate forward to meet them.

`v1` creates every table in `schema.md`. Keep migrations and that schema in lockstep.

## Import a translation

**Entry point:** the Settings tab → "Translations" (lists loaded translations and
offers "Import translation" — the single-user analogue of the server's admin
"view/load translations" panel).

**How the file arrives:** the user generates the canonical JSON on their computer with
the server repo's one-step `build-translation` command (against their own ESV/NLT/NKJV
PDF), then transfers it to the phone (Files app, cloud, USB, email). The app reads a
file the user picks; getting it onto the device is the user's step — the same posture
the server takes.

**Pipeline:**

```
pick .json  ─▶  read text  ─▶  validate (lib/schema/canonical.ts)
                                   │ invalid → show the validation error, write nothing
                                   ▼ valid
                              shared insert routine (lib/db/loadTranslation.ts)
                                   in ONE transaction, replace-by-code
                                   │
                                   ▼
                              invalidate TanStack Query caches (translations, reader)
                                   ▼
                              success → side-by-side comparison now includes it
```

- **File pick + read:** an HTML `<input type="file">` in the WebView with
  `file.text()` is the zero-extra-dependency path on Android and is preferred; reach
  for a native file-picker plugin only if the WebView input proves limiting.
- **Validate before load.** Validation runs against the full canonical schema *before*
  any write; a malformed file never partially loads. This is the **same contract** the
  server's `validate-translation` CLI enforces — `lib/schema/canonical.ts` (Zod) and
  `parsers/schema.py` (Pydantic) are two implementations of one schema, kept in
  lockstep. A file that validates on your computer imports cleanly on the phone.
- **Transactional, replace-by-code.** The insert is all-or-nothing; re-importing an
  existing `code` deletes and re-inserts that translation's Bible rows.
- **Re-import is always safe** (the Model B payoff): because journal tables hold no FK
  into Bible tables, deleting/re-inserting a translation never affects your entries —
  their snapshotted `scripture_text`, `scripture_translation_code`, and coordinate
  links are untouched.
- **Performance.** A full Bible is ~31k verse rows. Do the insert in a single
  transaction with batched/prepared statements (orders of magnitude faster than
  autocommit-per-row) and show progress ("Importing ESV…"). This on-device insert cost
  is precisely why the 13 bundled translations ship prebuilt instead of seeded —
  import is the only place the app pays it, and only for the few translations a user
  adds.

## Build-time recap (`build-bible-db`)

Node script (better-sqlite3, a devDependency — never shipped): run the migration set
on an empty DB → insert the 13 public-domain canonical JSONs via the shared routine →
set `user_version` → emit the asset into the Capacitor assets location the plugin
copies from. This is the only place the 13 JSONs are consumed; they don't ship in the
app.

## Decisions to confirm

1. **Backup/restore in v1.** The whole DB is one file, but Android keeps app-private
   files out of easy reach, so "copy the file" isn't as simple as on the server.
   Options: **(a) defer** — rely on the OS/cloud app-backup and add export/restore
   later (leanest); or **(b) minimal export/import** — a Settings action to share the
   DB file out and restore one back in. Given you'd hate to lose journal entries, (b)
   is worth considering even for v1, but it's additive scope. Your call.
2. **Default translation.** When multiple are loaded, the reader and new-entry form
   need a default. Simplest: the first-loaded (BSB), persisted as a preference in
   `localStorage` (alongside theme/reader settings), changeable in Settings. Confirm
   that's enough for v1, or if you want per-context memory (last-read translation).
