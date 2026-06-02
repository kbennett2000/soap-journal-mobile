/**
 * Canonical book list for the Protestant 66-book Bible.
 *
 * The single source of truth for book names, ordering, and accepted aliases.
 * The canonical JSON schema validates against this list; the reference parser
 * ("John 3:16", "Jn 3:16", "1 Cor 13") consumes the alias table; entry
 * coordinate linkage reads each book's canonical `order_index` (1..66).
 *
 * Adding aliases is cheap and additive — extend `aliases` as new ones come up.
 * Renaming a canonical `name` is a breaking change: it shifts what gets stored
 * in the `books` table and what the schema validator expects.
 *
 * Ported 1:1 from the soap-journal server's `core/bible/books.py`; that file
 * and its `books_test.py` are the source and the oracle for this module.
 */

export type Testament = 'OT' | 'NT'

export interface Book {
  readonly name: string
  readonly abbreviation: string
  readonly aliases: readonly string[]
  readonly testament: Testament
  readonly order_index: number
}

function b(
  name: string,
  abbreviation: string,
  testament: Testament,
  orderIndex: number,
  ...aliases: string[]
): Book {
  return Object.freeze({
    name,
    abbreviation,
    aliases: Object.freeze(aliases),
    testament,
    order_index: orderIndex,
  })
}

// Order matters: this is the canonical order_index 1..66.
export const ALL_BOOKS: readonly Book[] = Object.freeze([
  // ---- Old Testament -----------------------------------------------------
  b('Genesis', 'Gen', 'OT', 1, 'Gn', 'Ge'),
  b('Exodus', 'Exod', 'OT', 2, 'Ex', 'Exo'),
  b('Leviticus', 'Lev', 'OT', 3, 'Lv', 'Le'),
  b('Numbers', 'Num', 'OT', 4, 'Nm', 'Nu', 'Nb'),
  b('Deuteronomy', 'Deut', 'OT', 5, 'Dt', 'De', 'Deu'),
  b('Joshua', 'Josh', 'OT', 6, 'Jos', 'Jsh'),
  b('Judges', 'Judg', 'OT', 7, 'Jdg', 'Jgs'),
  b('Ruth', 'Ruth', 'OT', 8, 'Ru', 'Rth', 'Rut'),
  b('1 Samuel', '1 Sam', 'OT', 9, '1Sam', '1 Sm', '1Sm', 'First Samuel', '1Sa', '1st Samuel'),
  b('2 Samuel', '2 Sam', 'OT', 10, '2Sam', '2 Sm', '2Sm', 'Second Samuel', '2Sa', '2nd Samuel'),
  b('1 Kings', '1 Kgs', 'OT', 11, '1Kgs', '1 Ki', '1Ki', 'First Kings', '1st Kings'),
  b('2 Kings', '2 Kgs', 'OT', 12, '2Kgs', '2 Ki', '2Ki', 'Second Kings', '2nd Kings'),
  b('1 Chronicles', '1 Chr', 'OT', 13, '1Chr', '1 Ch', '1Ch', 'First Chronicles', '1st Chronicles'),
  b('2 Chronicles', '2 Chr', 'OT', 14, '2Chr', '2 Ch', '2Ch', 'Second Chronicles', '2nd Chronicles'),
  b('Ezra', 'Ezra', 'OT', 15, 'Ezr', 'Ez'),
  b('Nehemiah', 'Neh', 'OT', 16, 'Ne'),
  b('Esther', 'Esth', 'OT', 17, 'Est', 'Es'),
  b('Job', 'Job', 'OT', 18, 'Jb'),
  b('Psalms', 'Ps', 'OT', 19, 'Psalm', 'Pss', 'Psa', 'Pslm'),
  b('Proverbs', 'Prov', 'OT', 20, 'Prv', 'Pr', 'Pro'),
  b('Ecclesiastes', 'Eccl', 'OT', 21, 'Ecc', 'Ec', 'Qoh', 'Qoheleth'),
  b('Song of Solomon', 'Song', 'OT', 22, 'Song of Songs', 'SoS', 'SS', 'Sg', 'Sng', 'Canticles', 'Cant', 'Sol'),
  b('Isaiah', 'Isa', 'OT', 23, 'Is'),
  b('Jeremiah', 'Jer', 'OT', 24, 'Je', 'Jr'),
  b('Lamentations', 'Lam', 'OT', 25, 'La'),
  b('Ezekiel', 'Ezek', 'OT', 26, 'Eze', 'Ezk'),
  b('Daniel', 'Dan', 'OT', 27, 'Dn', 'Da'),
  b('Hosea', 'Hos', 'OT', 28, 'Ho'),
  b('Joel', 'Joel', 'OT', 29, 'Jl', 'Joe'),
  b('Amos', 'Amos', 'OT', 30, 'Am', 'Amo'),
  b('Obadiah', 'Obad', 'OT', 31, 'Ob', 'Oba'),
  b('Jonah', 'Jonah', 'OT', 32, 'Jon', 'Jnh'),
  b('Micah', 'Mic', 'OT', 33, 'Mc'),
  b('Nahum', 'Nah', 'OT', 34, 'Na'),
  b('Habakkuk', 'Hab', 'OT', 35, 'Hb'),
  b('Zephaniah', 'Zeph', 'OT', 36, 'Zep', 'Zp'),
  b('Haggai', 'Hag', 'OT', 37, 'Hg'),
  b('Zechariah', 'Zech', 'OT', 38, 'Zec', 'Zc'),
  b('Malachi', 'Mal', 'OT', 39, 'Ml'),
  // ---- New Testament -----------------------------------------------------
  b('Matthew', 'Matt', 'NT', 40, 'Mt', 'Mat'),
  b('Mark', 'Mark', 'NT', 41, 'Mk', 'Mrk', 'Mar'),
  b('Luke', 'Luke', 'NT', 42, 'Lk', 'Luk'),
  b('John', 'John', 'NT', 43, 'Jn', 'Jhn', 'Joh'),
  b('Acts', 'Acts', 'NT', 44, 'Ac', 'Act'),
  b('Romans', 'Rom', 'NT', 45, 'Ro', 'Rm'),
  b('1 Corinthians', '1 Cor', 'NT', 46, '1Cor', '1 Co', '1Co', 'First Corinthians', '1st Corinthians'),
  b('2 Corinthians', '2 Cor', 'NT', 47, '2Cor', '2 Co', '2Co', 'Second Corinthians', '2nd Corinthians'),
  b('Galatians', 'Gal', 'NT', 48, 'Ga'),
  b('Ephesians', 'Eph', 'NT', 49, 'Ephes'),
  b('Philippians', 'Phil', 'NT', 50, 'Php', 'Pp', 'Phi'),
  b('Colossians', 'Col', 'NT', 51, 'Co'),
  b('1 Thessalonians', '1 Thess', 'NT', 52, '1Thess', '1 Th', '1Th', 'First Thessalonians', '1st Thessalonians'),
  b('2 Thessalonians', '2 Thess', 'NT', 53, '2Thess', '2 Th', '2Th', 'Second Thessalonians', '2nd Thessalonians'),
  b('1 Timothy', '1 Tim', 'NT', 54, '1Tim', '1 Ti', '1Ti', 'First Timothy', '1st Timothy'),
  b('2 Timothy', '2 Tim', 'NT', 55, '2Tim', '2 Ti', '2Ti', 'Second Timothy', '2nd Timothy'),
  b('Titus', 'Titus', 'NT', 56, 'Ti', 'Tit'),
  b('Philemon', 'Phlm', 'NT', 57, 'Phm', 'Pm'),
  b('Hebrews', 'Heb', 'NT', 58, 'He'),
  b('James', 'Jas', 'NT', 59, 'Jm', 'Jam'),
  b('1 Peter', '1 Pet', 'NT', 60, '1Pet', '1 Pe', '1Pe', 'First Peter', '1st Peter'),
  b('2 Peter', '2 Pet', 'NT', 61, '2Pet', '2 Pe', '2Pe', 'Second Peter', '2nd Peter'),
  b('1 John', '1 John', 'NT', 62, '1Jn', '1 Jn', '1Jo', '1 Jo', 'First John', '1st John'),
  b('2 John', '2 John', 'NT', 63, '2Jn', '2 Jn', '2Jo', '2 Jo', 'Second John', '2nd John'),
  b('3 John', '3 John', 'NT', 64, '3Jn', '3 Jn', '3Jo', '3 Jo', 'Third John', '3rd John'),
  b('Jude', 'Jude', 'NT', 65, 'Jud', 'Jd'),
  b('Revelation', 'Rev', 'NT', 66, 'Re', 'Rv', 'Apocalypse', 'Apoc'),
])

/**
 * Lowercase-keyed lookup spanning every name, abbreviation, and alias.
 *
 * Built once at module load. Each Book is reachable through every form it
 * declares, including a normalized form that collapses internal whitespace
 * (so "1Corinthians" matches "1 Corinthians" if a caller forgets the space).
 */
function buildLookup(): Map<string, Book> {
  const table = new Map<string, Book>()
  for (const book of ALL_BOOKS) {
    const forms = new Set<string>([book.name, book.abbreviation, ...book.aliases])
    for (const form of forms) {
      const normalized = form.toLowerCase()
      const collapsed = normalized.replaceAll(' ', '')
      table.set(normalized, book)
      table.set(collapsed, book)
    }
  }
  return table
}

const LOOKUP: Map<string, Book> = buildLookup()

/**
 * Return the canonical Book for any accepted name/abbreviation/alias.
 *
 * Lookup is case-insensitive and whitespace-tolerant: "1cor", "1 Cor",
 * "1Cor", "1 Corinthians", and "First Corinthians" all resolve to the
 * same Book. Returns undefined when nothing matches.
 */
export function getBookByName(name: string): Book | undefined {
  if (!name) {
    return undefined
  }
  const key = name.trim().toLowerCase()
  if (!key) {
    return undefined
  }
  const direct = LOOKUP.get(key)
  if (direct) {
    return direct
  }
  return LOOKUP.get(key.replaceAll(' ', ''))
}

export function bookCount(): number {
  return ALL_BOOKS.length
}
