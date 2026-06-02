/**
 * Device shim: write the backup JSON to a temp file and open the native Share
 * sheet so the user can save it (Files / Drive / email / …).
 *
 * Thin and device-only — the serialization lives in `lib/db/journalExport.ts`
 * and is unit-tested; this is verified on-device. The Capacitor plugins are
 * loaded via dynamic `import()` so that merely importing this module (or the
 * hook that uses it) never pulls Capacitor at module-eval time, keeping the
 * headless test suite clean.
 */

export async function shareBackupFile(json: string, filename: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  const written = await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })

  await Share.share({
    title: 'SOAP Journal backup',
    url: written.uri,
    dialogTitle: 'Export backup',
  })
}
