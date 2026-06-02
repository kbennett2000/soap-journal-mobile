import { useExportBackup } from "@/hooks/useBackup";

/**
 * Settings "Backup & Restore" section. Export writes the whole journal to a
 * versioned JSON file and opens the native Share sheet. Restore (importing a
 * backup) lands in the next cycle.
 *
 * Journal-only: entries and their tags are backed up, not Bible text —
 * translations are re-importable from their own JSON.
 */
export function BackupRestore(): JSX.Element {
  const exportMutation = useExportBackup();

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="font-medium">Backup &amp; Restore</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Export your journal entries and tags to a file you can save or move to a new device.
          Bible text isn&apos;t included — re-import translations from their own JSON.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Export backup
        </button>

        {exportMutation.isPending && (
          <p data-testid="export-status" className="text-sm text-slate-600 dark:text-slate-300">
            Preparing backup…
          </p>
        )}

        {exportMutation.isSuccess && (
          <p
            data-testid="export-success"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            Exported {exportMutation.data.entryCount}{" "}
            {exportMutation.data.entryCount === 1 ? "entry" : "entries"}.
          </p>
        )}

        {exportMutation.isError && (
          <p
            role="alert"
            data-testid="export-error"
            className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
          >
            {exportMutation.error instanceof Error
              ? exportMutation.error.message
              : "Couldn't create the backup."}
          </p>
        )}
      </div>

      <p className="text-sm text-slate-500 dark:text-slate-400">
        Restoring from a backup is coming next.
      </p>
    </section>
  );
}
