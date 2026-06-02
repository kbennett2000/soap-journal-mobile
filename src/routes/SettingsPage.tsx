import { ThemeToggle } from '@/components/ThemeToggle'
import { TranslationImport } from '@/components/TranslationImport'

/**
 * Settings — theme toggle + translation import. Backup/restore + about land in
 * later cycles.
 */
export function SettingsPage(): JSX.Element {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="font-medium">Theme</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">Switch between light and dark.</p>
        </div>
        <ThemeToggle />
      </div>

      <TranslationImport />

      <p className="text-sm text-slate-600 dark:text-slate-300">
        Backup &amp; restore are coming soon.
      </p>
    </section>
  )
}
