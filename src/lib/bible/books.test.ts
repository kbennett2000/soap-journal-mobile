import { describe, expect, it } from 'vitest'

// Imported via the `@/` alias (not a relative path) to exercise the alias
// through both `tsc --noEmit` and Vitest — this is cycle 1, where that setup
// is established.
import { ALL_BOOKS, bookCount, getBookByName } from '@/lib/bible/books'

// Re-expression of the server's `core/bible/books_test.py` (the oracle),
// roughly 1:1 — same inputs, same resolution results. Cases that don't
// translate directly (None→undefined, identity→toBe, frozen-at-runtime) are
// noted inline.

describe('books', () => {
  it('ALL_BOOKS has 66 entries', () => {
    expect(bookCount()).toBe(66)
    expect(ALL_BOOKS.length).toBe(66)
  })

  it('order indices are 1..66 in sequence', () => {
    expect(ALL_BOOKS.map((b) => b.order_index)).toEqual(
      Array.from({ length: 66 }, (_, i) => i + 1),
    )
  })

  it('first and last canonical names', () => {
    expect(ALL_BOOKS[0].name).toBe('Genesis')
    expect(ALL_BOOKS[ALL_BOOKS.length - 1].name).toBe('Revelation')
  })

  it('testament split is 39 / 27', () => {
    const ot = ALL_BOOKS.filter((b) => b.testament === 'OT')
    const nt = ALL_BOOKS.filter((b) => b.testament === 'NT')
    expect(ot.length).toBe(39)
    expect(nt.length).toBe(27)
  })

  it('lookup by canonical name', () => {
    const book = getBookByName('Genesis')
    expect(book).not.toBeUndefined()
    expect(book!.name).toBe('Genesis')
  })

  it('lookup is case-insensitive', () => {
    // `is` identity in Python → reference equality here (same frozen object).
    expect(getBookByName('GENESIS')).toBe(getBookByName('genesis'))
    expect(getBookByName('genesis')!.name).toBe('Genesis')
  })

  it('lookup by abbreviation', () => {
    expect(getBookByName('Gen')!.name).toBe('Genesis')
    expect(getBookByName('1 Cor')!.name).toBe('1 Corinthians')
    expect(getBookByName('Rev')!.name).toBe('Revelation')
  })

  it('lookup by alias', () => {
    expect(getBookByName('Psalm')!.name).toBe('Psalms')
    expect(getBookByName('Song of Songs')!.name).toBe('Song of Solomon')
    expect(getBookByName('Canticles')!.name).toBe('Song of Solomon')
    expect(getBookByName('Apocalypse')!.name).toBe('Revelation')
    expect(getBookByName('First Corinthians')!.name).toBe('1 Corinthians')
  })

  it('lookup is whitespace-tolerant', () => {
    expect(getBookByName('1Cor')!.name).toBe('1 Corinthians')
    expect(getBookByName('1cor')!.name).toBe('1 Corinthians')
    expect(getBookByName('  John  ')!.name).toBe('John')
  })

  it('lookup unknown returns undefined', () => {
    // Python `is None` → `undefined` here (TS/Map idiom).
    expect(getBookByName('Book of Mormon')).toBeUndefined()
    expect(getBookByName('')).toBeUndefined()
    expect(getBookByName('   ')).toBeUndefined()
  })

  it('canonical names are unique', () => {
    const names = ALL_BOOKS.map((b) => b.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all 66 NKJV abbreviations resolve', () => {
    const nkjvAbbrs = [
      'Gen', 'Exo', 'Lev', 'Num', 'Deu', 'Jos', 'Jdg', 'Rut', '1Sa', '2Sa',
      '1Ki', '2Ki', '1Ch', '2Ch', 'Ezr', 'Neh', 'Est', 'Job', 'Psa', 'Pro',
      'Ecc', 'Sol', 'Isa', 'Jer', 'Lam', 'Eze', 'Dan', 'Hos', 'Joe', 'Amo',
      'Oba', 'Jon', 'Mic', 'Nah', 'Hab', 'Zep', 'Hag', 'Zec', 'Mal', 'Mat',
      'Mar', 'Luk', 'Joh', 'Act', 'Rom', '1Co', '2Co', 'Gal', 'Eph', 'Phi',
      'Col', '1Th', '2Th', '1Ti', '2Ti', 'Tit', 'Phm', 'Heb', 'Jam', '1Pe',
      '2Pe', '1Jo', '2Jo', '3Jo', 'Jud', 'Rev',
    ]
    expect(nkjvAbbrs.length).toBe(66)
    for (const abbr of nkjvAbbrs) {
      expect(getBookByName(abbr), `NKJV abbreviation ${abbr} not found`).not.toBeUndefined()
    }
  })

  it('the new NKJV aliases resolve correctly', () => {
    const expected: Record<string, string> = {
      Deu: 'Deuteronomy',
      Rut: 'Ruth',
      Sol: 'Song of Solomon',
      Joe: 'Joel',
      Amo: 'Amos',
      Oba: 'Obadiah',
      Mat: 'Matthew',
      Mar: 'Mark',
      Joh: 'John',
      Phi: 'Philippians',
      Jam: 'James',
    }
    for (const [abbr, name] of Object.entries(expected)) {
      const book = getBookByName(abbr)
      expect(book, `${abbr} should resolve`).not.toBeUndefined()
      expect(book!.name, `${abbr} -> ${book!.name}, expected ${name}`).toBe(name)
    }
  })

  it('all 17 NLT ordinal aliases resolve', () => {
    const expected: Record<string, string> = {
      '1st Samuel': '1 Samuel',
      '2nd Samuel': '2 Samuel',
      '1st Kings': '1 Kings',
      '2nd Kings': '2 Kings',
      '1st Chronicles': '1 Chronicles',
      '2nd Chronicles': '2 Chronicles',
      '1st Corinthians': '1 Corinthians',
      '2nd Corinthians': '2 Corinthians',
      '1st Thessalonians': '1 Thessalonians',
      '2nd Thessalonians': '2 Thessalonians',
      '1st Timothy': '1 Timothy',
      '2nd Timothy': '2 Timothy',
      '1st Peter': '1 Peter',
      '2nd Peter': '2 Peter',
      '1st John': '1 John',
      '2nd John': '2 John',
      '3rd John': '3 John',
    }
    expect(Object.keys(expected).length).toBe(17)
    for (const [alias, name] of Object.entries(expected)) {
      const book = getBookByName(alias)
      expect(book, `ordinal alias ${alias} should resolve`).not.toBeUndefined()
      expect(book!.name, `${alias} -> ${book!.name}, expected ${name}`).toBe(name)
    }
  })

  it('Book objects are frozen (immutable at runtime)', () => {
    // Python's `test_book_model_is_frozen` mutates and expects a raise. TS
    // `readonly` is compile-time only, so we verify the runtime freeze: the
    // cast is needed because the field is `readonly` at the type level.
    const book = ALL_BOOKS[0]
    expect(() => {
      ;(book as { name: string }).name = 'Other'
    }).toThrow()
  })
})
