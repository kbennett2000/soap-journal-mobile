import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'

import { DbProvider } from '@/context/DbProvider'
import { ALL_BOOKS } from '@/lib/bible/books'
import { createBetterSqliteExecutor } from '@/lib/db/betterSqliteConnection'
import type { DbExecutor } from '@/lib/db/executor'
import { loadTranslation } from '@/lib/db/loadTranslation'
import { runMigrations } from '@/lib/db/migrations'
import { CanonicalTranslationSchema } from '@/lib/schema/canonical'

// Headless render helper (no MSW — there's no HTTP). Wraps a UI in the same
// providers the app uses, with an injected DbProvider initializer and a
// MemoryRouter so route-aware components work without a real browser history.

function buildTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

/** A minimal valid 66-book translation so repositories have data to read. */
function syntheticTranslation(code = 'TST') {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }],
  }))
  return CanonicalTranslationSchema.parse({
    code,
    name: code,
    language: 'en',
    copyright: `© ${code}`,
    books,
  })
}

/**
 * An injected initializer that returns a fresh in-memory BetterSqliteExecutor,
 * migrated and seeded with one synthetic translation. Stands in for the real
 * Capacitor bootstrap.
 */
export function makeMemoryDbInitializer(code = 'TST'): () => Promise<DbExecutor> {
  return async () => {
    const db = createBetterSqliteExecutor(':memory:')
    await runMigrations(db)
    await loadTranslation(db, syntheticTranslation(code))
    return db
  }
}

interface RenderAppOptions {
  initialize?: () => Promise<DbExecutor>
  initialEntries?: string[]
  queryClient?: QueryClient
}

export function renderApp(ui: ReactElement, options: RenderAppOptions = {}): RenderResult {
  const {
    initialize = makeMemoryDbInitializer(),
    initialEntries = ['/'],
    queryClient = buildTestClient(),
  } = options

  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>
      <DbProvider initialize={initialize}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </DbProvider>
    </QueryClientProvider>
  )

  return render(ui, { wrapper: Wrapper })
}
