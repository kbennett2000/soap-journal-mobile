# soap-journal-mobile — Backup & Restore

A v1 feature: export your journal to a portable file and restore it. This resolves
decision #1 in `first-run-and-import.md` (backup/restore is **in** v1 scope).

## Scope: journal only, not the Bible text

The backup contains **entries, their tags, and their verse coordinates** — and nothing
from the Bible tables. Reasoning:

- **Precious vs reproducible.** Journal entries are the only irreplaceable data. Bible
  text is fully reproducible — the 13 bundled translations re-seed automatically on a
  fresh install, and your imported ESV/NLT/NKJV come back by re-importing the JSON you
  built from your PDFs.
- **Tiny and shareable.** A journal-only file is kilobytes, not the 100+ MB a
  full-DB copy would be, and it carries **no copyrighted Bible text**, so it's safe to
  move around or hand to a friend.
- **Model B makes it complete.** Entries are self-contained: each carries its
  snapshotted `scripture_text`, a stable `scripture_translation_code` label, and
  translation-agnostic `(book, chapter, verse)` coordinates. So a journal-only backup
  restores into a **fully functional** journal even before any translation is loaded —
  and the cross-reference badge works against whatever translations get added later.

This is the smarter version of the server's "copy the data folder": back up the part
that matters, regenerate the rest.

## Backup format

A single versioned JSON document. Entries embed their tags (by name) and verse
coordinates, so the file is self-contained and denormalized.

```json
{
  "format": "soap-journal-backup",
  "version": 1,
  "exported_at": "2026-06-02T14:00:00Z",
  "entries": [
    {
      "title": null,
      "entry_date": "2026-05-20",
      "scripture_ref": "John 3:16-21",
      "scripture_translation_code": "ESV",
      "scripture_text": "...",
      "observation": "...",
      "application": "...",
      "prayer": "...",
      "created_at": "2026-05-20T08:12:00Z",
      "updated_at": "2026-05-20T08:12:00Z",
      "verses": [ { "book_order_index": 43, "chapter": 3, "verse": 16 }, ... ],
      "tags": ["faith", "salvation"]
    }
  ]
}
```

- The backup format `version` is **independent** of the DB's `user_version` — it's an
  export contract, not the schema. Validate it with its own Zod schema.
- Timestamps (`created_at`, `updated_at`, `entry_date`) are preserved verbatim on
  restore, so recency and "on this day" stay meaningful.
- Tags are carried per-entry; restore uses the same case-insensitive get-or-create as
  a normal save. Empty/orphan tags (no entries) are not exported — they carry no
  information.

## Export

Settings tab → "Backup & Restore" → **Export backup**.

```
query all entries (+ their tags + verse coordinates)
  ─▶ serialize to the backup JSON
  ─▶ write a temp file
  ─▶ open the native Share sheet  → user saves to Files / Drive / email / etc.
```

On Android the robust path is Capacitor Filesystem (write the temp file) + the Share
plugin (hand the file URI to the share sheet) — programmatic WebView blob downloads
are unreliable. Verify the current Share/Filesystem API.

## Restore (replace, validate-before-destroy)

Settings tab → "Backup & Restore" → **Restore from backup**.

```
pick .json (HTML <input type="file">, same as translation import)
  ─▶ read text
  ─▶ validate the ENTIRE backup (Zod): format + version + every entry
  │      invalid → show error, change NOTHING
  ─▶ confirm: "Replace all current entries and tags with this backup?
  │            This cannot be undone."  [Cancel] [Replace]
  ─▶ ONE transaction:
  │      delete entry_tags, entry_scripture_verses, entries, tags
  │      insert entries → coordinate links → tags (get-or-create) → entry_tags
  ─▶ invalidate TanStack Query caches
```

Two non-negotiable safety rules:

- **Validate before destroy.** The whole backup is parsed and validated *before* any
  delete. Never wipe existing data and then discover the backup was bad — that would
  lose everything. (Same discipline as import's validate-before-load.)
- **Transactional.** The wipe + insert are one transaction; a mid-restore failure
  rolls back to the exact pre-restore state.

**Replace, not merge.** Restore means "make my journal match this backup." Merge —
adding a backup into an existing journal with duplicate detection and conflict
resolution — is a rabbit hole (entries have no natural unique key) and is **out of
scope for v1**.

## Edge cases

- A backup whose `version` is **newer** than the app understands is rejected with a
  clear "this backup is from a newer version" message.
- An **empty** backup (zero entries) is valid and restores to an empty journal; the
  confirmation copy should make the consequence obvious.
- Large journals (thousands of entries) insert in batches within the transaction.

## UI placement & dependencies

- A "Backup & Restore" section in the **Settings** tab, beside "Translations."
- New dependency: `@capacitor/share` (+ Capacitor Filesystem) for export. Restore
  reuses the HTML file input — no extra dependency.

## Out of scope for v1

Merge/conflict resolution; backing up Bible text or app preferences; automatic or
scheduled backups; any cloud/remote sync. (The server is the always-on instance; this
is the on-the-go one. Sync between them was ruled out at the start.)

## Tests (Vitest, repository level)

- **Round-trip:** export → wipe → restore → journal is identical (entries, tags,
  coordinates, timestamps).
- **Validation:** malformed file and newer-version file are both rejected with nothing
  written.
- **Validate-before-destroy:** an invalid backup leaves existing entries untouched.
- **Transactional:** a forced mid-restore failure rolls back to the pre-restore state.
