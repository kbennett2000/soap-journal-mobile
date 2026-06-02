import { useMutation } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { buildBackup } from "@/lib/db/journalExport";
import { shareBackupFile } from "@/lib/backupShare";

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
