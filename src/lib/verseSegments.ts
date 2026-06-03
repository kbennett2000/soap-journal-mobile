/**
 * Split a verse's plain text into ordered parts — text runs interleaved with
 * inline note markers at each typed note's `char_offset`. Pure and React-free
 * (unit-tested in isolation); a port of the server's verse-part splitter MINUS
 * the highlights/annotations machinery (a separate deferred feature).
 *
 * Only TYPED notes participate as markers: a footnote with `char_offset === null`
 * (every plain-translation footnote) is ignored here and rendered separately as
 * an end-of-verse marker. A verse with no typed notes returns a single text part,
 * so plain translations render exactly as before.
 */

import type { FootnoteResponse } from '@/types/api'

export interface VerseTextPart {
  type: 'text'
  text: string
}

export interface VerseMarkerPart {
  type: 'marker'
  note: FootnoteResponse
  /** 1-based display number for the marker (from the note's 0-based ordinal). */
  number: number
}

export type VersePart = VerseTextPart | VerseMarkerPart

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export function buildVerseParts(text: string, footnotes: FootnoteResponse[]): VersePart[] {
  const typed = footnotes
    .filter((f): f is FootnoteResponse & { char_offset: number } => f.char_offset !== null)
    .map((f) => ({ note: f, offset: clamp(f.char_offset, 0, text.length) }))
    // Stable order: by character position, then by the note's within-verse
    // ordinal so co-located markers render in a deterministic sequence.
    .sort((a, b) => a.offset - b.offset || a.note.ordinal - b.note.ordinal)

  // Fast path: nothing to interleave — one plain text part (unchanged output
  // for plain translations).
  if (typed.length === 0) {
    return [{ type: 'text', text }]
  }

  // Breakpoints: text bounds ∪ marker offsets.
  const breaks = new Set<number>([0, text.length])
  for (const t of typed) breaks.add(t.offset)
  const sorted = [...breaks].sort((a, b) => a - b)

  const parts: VersePart[] = []
  for (let i = 0; i < sorted.length; i++) {
    const at = sorted[i]!
    // Markers anchored exactly here, in (offset, ordinal) order.
    for (const t of typed) {
      if (t.offset === at) {
        parts.push({ type: 'marker', note: t.note, number: t.note.ordinal + 1 })
      }
    }
    const next = sorted[i + 1]
    if (next === undefined || next === at) continue
    parts.push({ type: 'text', text: text.slice(at, next) })
  }
  return parts
}
