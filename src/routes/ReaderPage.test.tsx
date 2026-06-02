import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/AppRoutes'
import { ALL_BOOKS } from '@/lib/bible/books'
import { createBetterSqliteExecutor } from '@/lib/db/betterSqliteConnection'
import type { DbExecutor } from '@/lib/db/executor'
import { loadTranslation } from '@/lib/db/loadTranslation'
import { runMigrations } from '@/lib/db/migrations'
import { CanonicalTranslationSchema } from '@/lib/schema/canonical'
import { renderApp } from '@/test/renderApp'

// Reader fixture: Genesis ch1 (5 verses incl. a heading, a footnote, a
// red-letter verse) + ch2 (3 verses), Exodus ch1, the rest minimal.
type Verse = { number: number; text: string; is_red_letter?: boolean }
type Chapter = {
  number: number
  verses: Verse[]
  headings?: { before_verse: number; text: string }[]
  footnotes?: { verse_number: number; text: string }[]
}

const OVERRIDES: Record<string, Chapter[]> = {
  Genesis: [
    {
      number: 1,
      verses: [
        { number: 1, text: 'Gen 1:1' },
        { number: 2, text: 'Gen 1:2' },
        { number: 3, text: 'Gen 1:3', is_red_letter: true },
        { number: 4, text: 'Gen 1:4' },
        { number: 5, text: 'Gen 1:5' },
      ],
      headings: [{ before_verse: 1, text: 'The Beginning' }],
      footnotes: [{ verse_number: 2, text: 'footnote on verse 2' }],
    },
    { number: 2, verses: [1, 2, 3].map((n) => ({ number: n, text: `Gen 2:${n}` })) },
  ],
  Exodus: [{ number: 1, verses: [{ number: 1, text: 'Exo 1:1' }] }],
}

function makeReaderInitializer(): () => Promise<DbExecutor> {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: OVERRIDES[spec.name] ?? [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }],
  }))
  const payload = CanonicalTranslationSchema.parse({
    code: 'TST',
    name: 'Test Translation',
    language: 'en',
    copyright: '© test',
    books,
  })
  return async () => {
    const db = createBetterSqliteExecutor(':memory:')
    await runMigrations(db)
    await loadTranslation(db, payload)
    return db
  }
}

function renderReader(path = '/read/TST/Genesis/1') {
  return renderApp(<AppRoutes />, {
    initialEntries: [path],
    initialize: makeReaderInitializer(),
  })
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  window.localStorage.clear()
})

describe('ReaderPage — chapter rendering', () => {
  it('renders the chapter title, verses, heading, footnote, and red-letter', async () => {
    const user = userEvent.setup()
    renderReader()

    expect(await screen.findByRole('heading', { name: 'Genesis 1' })).toBeInTheDocument()
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByText(`Gen 1:${n}`)).toBeInTheDocument()
    }
    // Section heading rendered inline.
    expect(screen.getByText('The Beginning')).toBeInTheDocument()
    // Red-letter styling on verse 3.
    expect(screen.getByTestId('verse-3').className).toContain('text-rose')

    // Footnote marker toggles its note.
    const footnoteBtn = screen.getByRole('button', { name: 'Footnote' })
    expect(screen.queryByText('footnote on verse 2')).not.toBeInTheDocument()
    await user.click(footnoteBtn)
    expect(await screen.findByText('footnote on verse 2')).toBeInTheDocument()
  })
})

describe('ReaderPage — navigation', () => {
  it('changes book via the picker', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Book' }), 'Exodus')
    expect(await screen.findByRole('heading', { name: 'Exodus 1' })).toBeInTheDocument()
  })

  it('changes chapter via the picker', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Chapter' }), '2')
    expect(await screen.findByRole('heading', { name: 'Genesis 2' })).toBeInTheDocument()
  })

  it('disables Previous on the first chapter of the first book', async () => {
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled()
  })

  it('navigates next across a book boundary (Genesis 2 → Exodus 1)', async () => {
    const user = userEvent.setup()
    renderReader('/read/TST/Genesis/2')
    await screen.findByRole('heading', { name: 'Genesis 2' })
    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByRole('heading', { name: 'Exodus 1' })).toBeInTheDocument()
  })

  it('moves chapters with the arrow keys', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('heading', { name: 'Genesis 2' })).toBeInTheDocument()
  })
})

describe('ReaderPage — jump bar', () => {
  it('resolves a valid reference and navigates', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.type(screen.getByRole('textbox', { name: /jump to reference/i }), 'Exodus 1:1')
    await user.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByRole('heading', { name: 'Exodus 1' })).toBeInTheDocument()
  })

  it('surfaces the ApiError message for an invalid reference without navigating', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.type(screen.getByRole('textbox', { name: /jump to reference/i }), 'Frodo 3:16')
    await user.click(screen.getByRole('button', { name: 'Go' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unknown book/i)
    // No navigation — still on Genesis 1.
    expect(screen.getByRole('heading', { name: 'Genesis 1' })).toBeInTheDocument()
  })
})

describe('ReaderPage — preferences persist', () => {
  it('toggles layout and persists it to localStorage', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.click(screen.getByRole('button', { name: 'Reader settings' }))
    await user.click(screen.getByRole('button', { name: 'Paragraph' }))
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('reader.layout') ?? '""')).toBe('paragraph')
    })
  })

  it('changes font size and persists it', async () => {
    const user = userEvent.setup()
    renderReader()
    await screen.findByRole('heading', { name: 'Genesis 1' })
    await user.click(screen.getByRole('button', { name: 'Reader settings' }))
    await user.click(screen.getByRole('button', { name: 'L' }))
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem('reader.fontSize') ?? '""')).toBe('L')
    })
  })
})
