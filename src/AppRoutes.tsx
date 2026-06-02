import { Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/AppShell'
import { CalendarPage } from '@/routes/CalendarPage'
import { DashboardPage } from '@/routes/DashboardPage'
import { EntryDetailPage } from '@/routes/EntryDetailPage'
import { EntryEditPage } from '@/routes/EntryEditPage'
import { EntryListPage } from '@/routes/EntryListPage'
import { EntryNewPage } from '@/routes/EntryNewPage'
import { NotFoundPage } from '@/routes/NotFoundPage'
import { ReaderPage } from '@/routes/ReaderPage'
import { SettingsPage } from '@/routes/SettingsPage'

/**
 * Declarative route tree (vs the web app's createBrowserRouter) so tests can
 * mount it under MemoryRouter and production under BrowserRouter. Auth/admin
 * routes are gone; every page renders inside AppShell (the tab-bar chrome).
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/read" element={<ReaderPage />} />
        <Route
          path="/read/:translationCode/:bookName/:chapterNumber"
          element={<ReaderPage />}
        />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/entries" element={<EntryListPage />} />
        <Route path="/entries/new" element={<EntryNewPage />} />
        <Route path="/entries/:entryId" element={<EntryDetailPage />} />
        <Route path="/entries/:entryId/edit" element={<EntryEditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
