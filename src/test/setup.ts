import '@testing-library/jest-dom'

import { afterEach, beforeEach, vi } from 'vitest'

// This setup runs for every test file, including the node-environment DB tests
// (which have no `window`). Guard all browser-only setup so those are untouched.
const hasWindow = typeof window !== 'undefined'

// happy-dom doesn't ship matchMedia; the theme module reads it via
// prefers-color-scheme on mount. Stub it before any component renders.
if (hasWindow && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

beforeEach(() => {
  if (!hasWindow) return
  // Each UI test starts with no persisted theme and a clean document root.
  window.localStorage.clear()
  document.documentElement.className = ''
})

afterEach(() => {
  if (!hasWindow) return
  // Components are unmounted by RTL's auto-cleanup (globals: true).
  window.localStorage.clear()
})
