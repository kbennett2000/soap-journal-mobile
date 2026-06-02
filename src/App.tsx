import { BrowserRouter } from 'react-router-dom'

import { AppRoutes } from '@/AppRoutes'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { DbProvider } from '@/context/DbProvider'
import { initializeAppDb } from '@/lib/db/appDb'

/**
 * Production composition: a top-level error boundary, the database boot gate
 * (DbProvider), and the router. `QueryClientProvider` wraps this in main.tsx.
 *
 * Browser-history routing assumes the Android WebView serves index.html for
 * deep paths; if they 404 on device, switch BrowserRouter → HashRouter (the
 * documented fallback) — verified in the device cycle.
 */
export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <DbProvider initialize={initializeAppDb}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </DbProvider>
    </ErrorBoundary>
  )
}
