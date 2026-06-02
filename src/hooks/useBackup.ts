import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { invalidateAllEntryViews } from "@/hooks/useEntries";
import { buildBackup } from "@/lib/db/journalExport";
import { restoreJournal } from "@/lib/db/journalRestore";
import { shareBackupFile } from "@/lib/backupShare";
import type { Backup } from "@/lib/schema/backup";

export interface ExportResult {
  entryCount: number;
  filename: string;
}

/**
 * Export the journal to a versioned JSON file and open the native Share sheet.
 * Read-only — no cache invalidation. The serialization (`buildBackup`) is
 * headless and unit-tested; the file write + share is the thin device shim.
 */
export function useExportBackup() {
  const db = useDb();
  return useMutation<ExportResult>({
    mutationFn: async () => {
      const exportedAt = new Date().toISOString();
      const backup = await buildBackup(db, exportedAt);
      const filename = `soap-journal-backup-${exportedAt.slice(0, 10)}.json`;
      await shareBackupFile(JSON.stringify(backup, null, 2), filename);
      return { entryCount: backup.entries.length, filename };
    },
  });
}

export interface RestoreResult {
  entryCount: number;
}

/**
 * Restore the journal from an ALREADY-VALIDATED backup (the UI runs `parseBackup`
 * before the destructive confirm, so this mutation is purely the wipe+insert).
 * On success, refresh every entry view — the Bible tables are untouched.
 */
export function useRestoreBackup() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation<RestoreResult, Error, Backup>({
    mutationFn: (backup: Backup) => restoreJournal(db, backup),
    onSuccess: () => invalidateAllEntryViews(qc),
  });
}
