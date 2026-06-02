import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DashboardPage } from '@/routes/DashboardPage'
import { renderApp } from '@/test/renderApp'

describe('DashboardPage (live DB count — boot proof)', () => {
  it('reads the executor through useDb and shows the translation count', async () => {
    // renderApp seeds one synthetic translation via the injected initializer.
    renderApp(<DashboardPage />)
    expect(await screen.findByText('1 translation available')).toBeInTheDocument()
  })
})
