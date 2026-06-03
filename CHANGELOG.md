# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-06-03

### Fixed

- **Dashboard no longer scrolls sideways.** A long entry title could stretch the page
  wider than the screen (in both portrait and landscape); recent-entry titles now truncate
  within their card so the layout stays put.
- **More reliable sideloading.** Release APKs are now signed with both the v1 (JAR) and v2
  signature schemes, so installs succeed on devices that rejected the earlier v2-only build.

[1.0.1]: https://github.com/kbennett2000/soap-journal-mobile/releases/tag/v1.0.1

## [1.0.0] — 2026-06-03

Initial public release.

### Added

- **Bible reader** with **13 bundled translations** (twelve public domain; the Berean
  Standard Bible is freely licensed) — no download or setup needed; works fully offline.
- **Jump-to-a-passage bar** (e.g. `John 3:16`, `Romans 8:28-30`), book/chapter pickers,
  previous/next navigation, selectable text size, and verse-by-verse or flowing-paragraph
  layout.
- **Compare two translations** side by side — side-by-side in landscape, stacked when
  upright; each pane has its own translation picker.
- **SOAP journaling** (Scripture · Observation · Application · Prayer): start an entry from
  a tapped verse with the reference and text pre-filled; add a title, date, translation,
  and tags. Create, edit, and delete entries.
- **Find your way back:** search and filter your journal by word, book, tag, and date, with
  ordering and pagination; a **calendar** of the days you wrote; **"on this day in previous
  years";** a dashboard of recent entries; and an "entries on this chapter" badge in the
  reader.
- **Optional translator's notes:** when the NET Bible is imported, its verses show inline
  numbered note markers that open translator/study/text-critical notes with tappable
  cross-references.
- **Import your own translations** (Settings → Translations) from a prepared canonical-JSON
  file; re-importing replaces an existing translation.
- **Backup & restore** your journal to a JSON file you control (validate-before-replace).
- **Light and dark themes.**
- Fully **offline** — no account, no sign-in, no cloud, no tracking; data stored locally in
  SQLite.

[1.0.0]: https://github.com/kbennett2000/soap-journal-mobile/releases/tag/v1.0.0
