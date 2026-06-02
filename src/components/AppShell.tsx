import { Outlet } from 'react-router-dom'

import { BottomTabBar } from '@/components/BottomTabBar'

/**
 * App chrome (replaces the web app's Layout): scrollable content area with the
 * bottom tab bar pinned beneath it. Used as the layout route wrapping every
 * page. No top bar / username / logout — single-user, no auth.
 */
export function AppShell(): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  )
}
