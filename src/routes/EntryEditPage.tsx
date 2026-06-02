import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { EntryForm, type EntryFormValues } from "@/components/EntryForm";
import { useDeleteEntry, useEntry, useSaveEntry } from "@/hooks/useEntries";
import { ApiError } from "@/lib/db/errors";
import { entryToFormValues } from "@/lib/entryFormDefaults";

export function EntryEditPage(): JSX.Element {
  const { entryId: entryIdParam } = useParams<{ entryId: string }>();
  const entryId = Number.parseInt(entryIdParam ?? "", 10);
  const validId = Number.isFinite(entryId) && entryId > 0;

  const query = useEntry(validId ? entryId : undefined);
  const saveMutation = useSaveEntry(entryId);
  const deleteMutation = useDeleteEntry();
  const navigate = useNavigate();

  const initialValues = useMemo<EntryFormValues | null>(() => {
    if (!query.data) return null;
    return entryToFormValues(query.data);
  }, [query.data]);

  if (
    !validId ||
    (query.isError && query.error instanceof ApiError && query.error.status === 404)
  ) {
    return <NotFoundPanel />;
  }

  if (query.isLoading || !initialValues) {
    return (
      <div data-testid="entry-edit-loading" className="space-y-3">
        <div className="h-7 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    );
  }

  async function handleSubmit(values: EntryFormValues): Promise<void> {
    const updated = await saveMutation.mutateAsync({
      title: values.title.trim() ? values.title.trim() : null,
      entry_date: values.entryDate,
      scripture_ref: values.scriptureRef,
      translation_code: values.translationCode,
      observation: values.observation,
      application: values.application,
      prayer: values.prayer,
      tags: values.tags,
    });
    navigate(`/entries/${updated.id}`);
  }

  async function handleDelete(): Promise<void> {
    await deleteMutation.mutateAsync(entryId);
    navigate("/entries");
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Edit entry</h1>
      <EntryForm
        // Remount the form when the loaded entry changes so initialValues
        // truly initialize state — EntryForm doesn't sync props into
        // state with an effect (see its top-of-component comment).
        key={query.data?.id ?? "loading"}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
        onDelete={handleDelete}
      />
    </div>
  );
}

function NotFoundPanel(): JSX.Element {
  return (
    <div
      data-testid="entry-not-found"
      className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">Entry not found.</p>
      <Link
        to="/entries"
        className="mt-3 inline-flex h-9 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
      >
        Back to entries
      </Link>
    </div>
  );
}
