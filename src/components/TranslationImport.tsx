import { type ChangeEvent, useRef } from "react";

import { useImportTranslation, useTranslations } from "@/hooks/useBible";
import { ImportError } from "@/lib/db/importTranslation";

/**
 * Settings "Translations" section: lists the loaded translations and imports a
 * new one from a canonical-JSON file the user supplies.
 *
 * The file-input is a thin shim — it reads the picked file's text and hands it
 * to `useImportTranslation`; all the parse/validate/load logic lives in
 * `lib/db/importTranslation`. Only translations the user has the legal right to
 * use should be imported; nothing copyrighted ships with the app.
 */
export function TranslationImport(): JSX.Element {
  const translationsQuery = useTranslations();
  const mutation = useImportTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    mutation.mutate(text);
  }

  const translations = translationsQuery.data?.translations ?? [];

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="font-medium">Translations</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Import a translation you have the legal right to use, as canonical JSON exported
          from soap-journal. Re-importing the same code replaces it.
        </p>
      </div>

      {translations.length > 0 ? (
        <ul data-testid="loaded-translations" className="space-y-1">
          {translations.map((t) => (
            <li
              key={t.code}
              className="flex items-baseline gap-2 text-sm text-slate-700 dark:text-slate-200"
            >
              <span className="inline-flex h-5 items-center rounded bg-slate-100 px-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {t.code}
              </span>
              <span>{t.name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No translations loaded.</p>
      )}

      <div className="space-y-2">
        <label
          htmlFor="import-translation-file"
          className="inline-flex h-10 cursor-pointer items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Import translation
        </label>
        <input
          ref={inputRef}
          id="import-translation-file"
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          disabled={mutation.isPending}
          className="sr-only"
        />

        {mutation.isPending && (
          <p data-testid="import-status" className="text-sm text-slate-600 dark:text-slate-300">
            Importing… this can take a few seconds for a full Bible.
          </p>
        )}

        {mutation.isSuccess && (
          <p
            data-testid="import-success"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            Imported {mutation.data.name} — {mutation.data.counts.books} books,{" "}
            {mutation.data.counts.verses} verses.
          </p>
        )}

        {mutation.isError && <ImportErrorPanel error={mutation.error} />}
      </div>
    </section>
  );
}

function ImportErrorPanel({ error }: { error: unknown }): JSX.Element {
  const message =
    error instanceof ImportError ? error.message : "Something went wrong during import.";
  const details =
    error instanceof ImportError && error.kind === "validation" ? error.errors ?? [] : [];

  return (
    <div
      role="alert"
      data-testid="import-error"
      className="space-y-1 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
    >
      <p>{message}</p>
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
