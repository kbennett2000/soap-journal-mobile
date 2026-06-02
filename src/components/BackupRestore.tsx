import { type ChangeEvent, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useExportBackup, useRestoreBackup } from "@/hooks/useBackup";
import { parseBackup, RestoreError } from "@/lib/db/journalRestore";
import type { Backup } from "@/lib/schema/backup";

/**
 * Settings "Backup & Restore" section.
 *
 * Export writes the whole journal to a versioned JSON file and opens the native
 * Share sheet. Restore is **replace, not merge** and destructive: the picked
 * file is fully validated BEFORE anything is touched (validate-before-destroy);
 * only after an explicit confirm does the one-transaction wipe+insert run.
 *
 * Journal-only: entries and their tags are backed up/restored, not Bible text —
 * translations are re-importable from their own JSON.
 */
export function BackupRestore(): JSX.Element {
  const exportMutation = useExportBackup();
  const restoreMutation = useRestoreBackup();

  // The validated backup awaiting the destructive confirm, and any pre-confirm
  // validation error. Validation happens at file-pick, before the dialog opens.
  const [pending, setPending] = useState<Backup | null>(null);
  const [validationError, setValidationError] = useState<RestoreError | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    setValidationError(null);
    restoreMutation.reset();
    const text = await file.text();
    try {
      // Validate-before-destroy: nothing is touched until this passes.
      setPending(parseBackup(text));
    } catch (err) {
      if (err instanceof RestoreError) setValidationError(err);
      else setValidationError(new RestoreError("parse", "Couldn't read that backup file."));
    }
  }

  function confirmRestore(): void {
    if (!pending) return;
    restoreMutation.mutate(pending);
    setPending(null);
  }

  return (
    <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="font-medium">Backup &amp; Restore</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Export your journal entries and tags to a file you can save or move to a new device,
          or restore from one. Bible text isn&apos;t included — re-import translations from
          their own JSON.
        </p>
      </div>

      {/* Export */}
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

      {/* Restore */}
      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Restoring <strong>replaces</strong> all current entries and tags with the backup&apos;s.
        </p>
        <label
          htmlFor="restore-backup-file"
          className="inline-flex h-10 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Restore from backup
        </label>
        <input
          id="restore-backup-file"
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          disabled={restoreMutation.isPending}
          className="sr-only"
        />

        {restoreMutation.isPending && (
          <p data-testid="restore-status" className="text-sm text-slate-600 dark:text-slate-300">
            Restoring…
          </p>
        )}
        {restoreMutation.isSuccess && (
          <p
            data-testid="restore-success"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            Restored {restoreMutation.data.entryCount}{" "}
            {restoreMutation.data.entryCount === 1 ? "entry" : "entries"}.
          </p>
        )}
        {validationError && <RestoreErrorPanel error={validationError} />}
        {restoreMutation.isError && (
          <RestoreErrorPanel
            error={
              restoreMutation.error instanceof RestoreError
                ? restoreMutation.error
                : new RestoreError("restore", "The restore failed; your journal is unchanged.")
            }
          />
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Restore from backup"
        message={
          pending
            ? `Replace all current entries and tags with this backup? This cannot be undone. This backup has ${pending.entries.length} ${pending.entries.length === 1 ? "entry" : "entries"}.`
            : ""
        }
        confirmLabel="Replace"
        destructive
        onConfirm={confirmRestore}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

function RestoreErrorPanel({ error }: { error: RestoreError }): JSX.Element {
  const details = error.kind === "validation" ? error.errors ?? [] : [];
  return (
    <div
      role="alert"
      data-testid="restore-error"
      className="space-y-1 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
    >
      <p>{error.message}</p>
      {details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {details.slice(0, 3).map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
