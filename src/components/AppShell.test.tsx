import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AppRoutes } from '@/AppRoutes'
import { renderApp } from '@/test/renderApp'

// Renders the real route tree under the injected DbProvider (ready) +
// MemoryRouter, and drives the bottom-tab navigation.

async function renderShell(initialEntries: string[] = ['/']) {
  renderApp(<AppRoutes />, { initialEntries })
  // Wait past DbProvider's "Loading…" gate.
  await screen.findByRole('navigation', { name: 'Primary' })
}

describe('AppShell + BottomTabBar', () => {
  it('renders all five tabs', async () => {
    await renderShell()
    for (const label of ['Dashboard', 'Reader', 'Entries', 'Calendar', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('boots to the Dashboard', async () => {
    await renderShell()
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('navigates between tabs', async () => {
    const user = userEvent.setup()
    await renderShell()

    await user.click(screen.getByRole('link', { name: 'Entries' }))
    expect(await screen.findByRole('heading', { name: 'Entries' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Calendar' }))
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('marks the active tab via aria-current', async () => {
    await renderShell()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

    // Use a still-stub tab (Calendar) so the assertion doesn't depend on a
    // feature page's content; it's purely about active-tab state.
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'Calendar' }))
    await screen.findByRole('heading', { name: 'Calendar' })
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('renders the 404 page for an unknown route, with the tab bar still present', async () => {
    await renderShell(['/nope'])
    expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
  })
})

describe('theme toggle (Settings)', () => {
  it('toggles dark mode and persists it', async () => {
    const user = userEvent.setup()
    await renderShell(['/settings'])
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    expect(document.documentElement.classList.contains('dark')).toBe(false)

    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }))
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
    expect(window.localStorage.getItem('theme')).toBe('dark')

    await user.click(screen.getByRole('button', { name: /switch to light theme/i }))
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
    expect(window.localStorage.getItem('theme')).toBe('light')
  })
})
