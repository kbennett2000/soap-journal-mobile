# Screenshots

This folder holds the images the top-level [`README.md`](../../README.md) references. The
README links each file by name, so the gallery and tour render as soon as you drop the
captured PNGs in here — no README edit needed.

> **Status:** placeholders. The README points at these exact filenames; until they're
> captured, GitHub shows a broken-image icon in those spots. Capture them before cutting
> the first public release.

## How to capture (Android, over USB)

With the app installed and a screen set up, capture straight from the device with `adb`:

```bash
adb exec-out screencap -p > docs/screenshots/<name>.png
```

Tips:
- Use a **clean device** look: full battery, no clutter in the status bar if you can help it.
- Seed a little **sample journal data** first so the dashboard/entries screens aren't empty.
- For the **compare** shot, rotate the phone to **landscape** before capturing so the two
  translations sit side by side (that's the layout the caption promises).
- Keep them reasonably sized; large PNGs bloat the repo. Crop device chrome if you prefer.

## Shot list

Capture each of these to the exact filename — the README references them verbatim.

| File | What to show |
| --- | --- |
| `usage-reader.png` | A chapter open in the reader, **single pane** — readable text, a verse or two visible, the controls bar. |
| `usage-reader-net-note.png` | An **open NET translator's note** — the type label (e.g. "Translator's Note") and at least one **tappable cross-reference chip**. (Requires the NET Bible imported.) |
| `usage-compare-landscape.png` | **Landscape**, two translations **side by side**, each with its own picker. |
| `usage-entry-from-verse.png` | The **new-entry form pre-filled from a tapped verse** — the scripture reference + text filled in, with the SOAP fields (Observation / Application / Prayer) and tags visible. |
| `usage-dashboard.png` | The **dashboard** — recent entries, "on this day," and the jump bar. |
| `install-unknown-sources.png` | Android's **"allow installs from this source"** system prompt (the per-app toggle shown during install). |
| `install-play-protect.png` | The **Play Protect / "unrecognized app"** dialog, ideally showing the **More details → Install anyway** path. |
