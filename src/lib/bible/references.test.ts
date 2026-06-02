import { describe, expect, it } from 'vitest'

import {
  ReferenceParseError,
  parseReference,
  parseReferenceOrRaise,
} from '@/lib/bible/references'

// Re-expression of the server's `core/references_test.py` (the oracle),
// roughly 1:1 — same inputs, same accept/reject results and the same distinct
// error messages.

// Mirrors pytest's `pytest.raises(ReferenceParseError, match="substr")`:
// asserts both the error type and that the message contains the substring.
// The oracle's `match` substrings are all literal text.
function expectParseError(fn: () => unknown, substring: string): void {
  let thrown: unknown
  try {
    fn()
  } catch (err) {
    thrown = err
  }
  expect(thrown, `expected a throw containing ${JSON.stringify(substring)}`).toBeInstanceOf(
    ReferenceParseError,
  )
  expect((thrown as Error).message).toContain(substring)
}

describe('references — accepted forms', () => {
  it('single verse', () => {
    const ref = parseReference('John 3:16')
    expect(ref.book.name).toBe('John')
    expect(ref.chapter).toBe(3)
    expect(ref.startVerse).toBe(16)
    expect(ref.endVerse).toBe(16)
    expect(ref.canonicalString).toBe('John 3:16')
  })

  it('verse range', () => {
    const ref = parseReference('John 3:16-20')
    expect(ref.startVerse).toBe(16)
    expect(ref.endVerse).toBe(20)
    expect(ref.canonicalString).toBe('John 3:16-20')
  })

  it('whole chapter', () => {
    const ref = parseReference('John 3')
    expect(ref.chapter).toBe(3)
    expect(ref.startVerse).toBeNull()
    expect(ref.endVerse).toBeNull()
    expect(ref.canonicalString).toBe('John 3')
  })

  it('abbreviation', () => {
    const ref = parseReference('Jn 3:16')
    expect(ref.book.name).toBe('John')
    expect(ref.canonicalString).toBe('John 3:16')
  })

  it('no-space numbered book', () => {
    const ref = parseReference('1John 3:16')
    expect(ref.book.name).toBe('1 John')
    expect(ref.canonicalString).toBe('1 John 3:16')
  })

  it('spaced numbered book abbreviation', () => {
    const ref = parseReference('1 Cor 13')
    expect(ref.book.name).toBe('1 Corinthians')
    expect(ref.canonicalString).toBe('1 Corinthians 13')
  })

  it('alias: Song of Songs', () => {
    const ref = parseReference('Song of Songs 2:1')
    expect(ref.book.name).toBe('Song of Solomon')
    expect(ref.canonicalString).toBe('Song of Solomon 2:1')
  })

  it('alias: Apocalypse', () => {
    const ref = parseReference('Apocalypse 22:21')
    expect(ref.book.name).toBe('Revelation')
    expect(ref.canonicalString).toBe('Revelation 22:21')
  })

  it('lowercase input normalizes to canonical', () => {
    const ref = parseReference('john 3:16')
    expect(ref.canonicalString).toBe('John 3:16')
  })

  it('uppercase input normalizes', () => {
    const ref = parseReference('JOHN 3:16')
    expect(ref.canonicalString).toBe('John 3:16')
  })

  it('whitespace tolerant', () => {
    const ref = parseReference('  John   3 : 16 - 20  ')
    expect(ref.canonicalString).toBe('John 3:16-20')
  })

  it('en dash range', () => {
    const ref = parseReference('John 3:16–20')
    expect(ref.canonicalString).toBe('John 3:16-20')
  })

  it('em dash range', () => {
    const ref = parseReference('John 3:16—20')
    expect(ref.canonicalString).toBe('John 3:16-20')
  })

  it('mixed alias with range normalizes', () => {
    const ref = parseReference('jn 3:16-20')
    expect(ref.canonicalString).toBe('John 3:16-20')
  })

  it('single-verse range collapses to single verse', () => {
    const ref = parseReference('John 3:16-16')
    expect(ref.startVerse).toBe(16)
    expect(ref.endVerse).toBe(16)
    expect(ref.canonicalString).toBe('John 3:16')
  })
})

describe('references — rejected forms', () => {
  it('empty input', () => {
    expectParseError(() => parseReference(''), 'empty')
  })

  it('whitespace-only input', () => {
    expectParseError(() => parseReference('   '), 'empty')
  })

  it('book only', () => {
    expectParseError(() => parseReference('John'), 'missing a chapter number')
  })

  it('unknown book', () => {
    expectParseError(() => parseReference('Frodo 3:16'), 'unknown book')
  })

  it('reversed range', () => {
    expectParseError(() => parseReference('John 3:20-16'), 'end verse must be >= start verse')
  })

  it('chapter zero', () => {
    expectParseError(() => parseReference('John 0:1'), 'chapter must be 1')
  })

  it('verse zero', () => {
    expectParseError(() => parseReference('John 3:0'), 'verse must be 1')
  })

  it('negative chapter falls through to generic parse error', () => {
    expectParseError(() => parseReference('John -1:1'), 'could not parse')
  })

  it('garbage input', () => {
    expectParseError(() => parseReference('hello'), 'could not parse')
  })

  it('chapter only, no book', () => {
    expectParseError(() => parseReference('3:16'), 'could not parse')
  })

  it('colon with no verse', () => {
    expectParseError(() => parseReference('John :'), 'could not parse')
  })

  it('multiple references (semicolon)', () => {
    expectParseError(() => parseReference('John 3:16; Rom 8:28'), 'multiple references')
  })

  it('multiple references (comma)', () => {
    expectParseError(() => parseReference('John 3:16, Rom 8:28'), 'multiple references')
  })

  it('cross-chapter range rejected via strict parser', () => {
    expectParseError(
      () => parseReferenceOrRaise('John 3:30-4:2'),
      'cross-chapter ranges are not supported',
    )
  })

  it('cross-chapter range also rejected by base parser', () => {
    // Base parseReference doesn't know the "cross-chapter not supported"
    // branding but still rejects because the regex won't match.
    expectParseError(() => parseReference('John 3:30-4:2'), 'could not parse')
  })
})
