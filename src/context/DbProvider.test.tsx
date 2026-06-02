import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { useDb } from '@/hooks/useDb'
import { listTranslations } from '@/lib/db/bible'
import { createBetterSqliteExecutor } from '@/lib/db/betterSqliteConnection'
import type { DbExecutor } from '@/lib/db/executor'
import { runMigrations } from '@/lib/db/migrations'
import { makeMemoryDbInitializer, renderApp } from '@/test/renderApp'

describe('DbProvider lifecycle', () => {
  it('shows the loading gate while initializing', () => {
    renderApp(<div>ready content</div>, { initialize: () => new Promise<DbExecutor>(() => {}) })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('ready content')).not.toBeInTheDocument()
  })

  it('shows a retry-able error gate when initialization fails', async () => {
    renderApp(<div>ready content</div>, {
      initialize: () => Promise.reject(new Error('disk on fire')),
    })
    expect(
      await screen.findByRole('heading', { name: /couldn.t open the journal database/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('disk on fire')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('ready content')).not.toBeInTheDocument()
  })

  it('retry re-runs the initializer and recovers', async () => {
    let attempt = 0
    const initialize = async (): Promise<DbExecutor> => {
      attempt += 1
      if (attempt === 1) throw new Error('first attempt fails')
      const db = createBetterSqliteExecutor(':memory:')
      await runMigrations(db)
      return db
    }
    renderApp(<div>ready content</div>, { initialize })

    await screen.findByRole('button', { name: 'Retry' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('ready content')).toBeInTheDocument()
  })

  it('renders children once ready', async () => {
    renderApp(<div>ready content</div>)
    expect(await screen.findByText('ready content')).toBeInTheDocument()
  })
})

// End-to-end seam: a consumer reads the executor from the provider via useDb
// and calls a real repository through it.
function TranslationCodes(): JSX.Element {
  const db = useDb()
  const { data } = useQuery({
    queryKey: ['translations'],
    queryFn: () => listTranslations(db),
  })
  return <div data-testid="codes">{(data?.translations ?? []).map((t) => t.code).join(',')}</div>
}

describe('DbProvider seam (useDb → repository)', () => {
  it('flows the executor from provider to hook to repository', async () => {
    renderApp(<TranslationCodes />, { initialize: makeMemoryDbInitializer('WEB') })
    expect(await screen.findByText('WEB')).toBeInTheDocument()
  })
})
