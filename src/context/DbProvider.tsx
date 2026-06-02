import { useEffect, useState, type ReactNode } from 'react'

import type { DbExecutor } from '@/lib/db/executor'

import { DbContext } from './DbContext'

interface DbProviderProps {
  /**
   * Opens the database and returns a ready executor. Injected so tests pass a
   * BetterSqliteExecutor-based initializer and the real Capacitor bootstrap
   * (copyFromAssets → createConnection → runMigrations → CapacitorSqliteExecutor)
   * plugs in during the device cycle. Should be a stable reference.
   */
  initialize: () => Promise<DbExecutor>
  children: ReactNode
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; executor: DbExecutor }
  | { status: 'error'; message: string }

/**
 * Boots the database before rendering the app. This loading gate replaces the
 * web app's auth gate (RequireAuth): the single-user app boots straight to the
 * dashboard once the DB is ready. While initializing it shows a spinner; on
 * failure, a retry-able error; once ready, it provides the executor via context.
 */
export function DbProvider({ initialize, children }: DbProviderProps): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  // Bumped by Retry to re-run the initializer effect.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    // setState happens in async callbacks (not synchronously in the effect
    // body), so the loading→ready/error transition doesn't cascade renders.
    initialize().then(
      (executor) => {
        if (!cancelled) setState({ status: 'ready', executor })
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [initialize, attempt])

  function retry(): void {
    setState({ status: 'loading' })
    setAttempt((a) => a + 1)
  }

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-xl font-semibold">Couldn&apos;t open the journal database</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            The app needs its local database to start. You can retry; if this keeps
            happening, reinstalling restores the bundled Bible data.
          </p>
          <pre className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {state.message}
          </pre>
          <button
            type="button"
            onClick={retry}
            className="inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <DbContext.Provider value={state.executor}>{children}</DbContext.Provider>
}
