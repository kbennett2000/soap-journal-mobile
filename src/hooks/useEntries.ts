import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { getEntry, listEntries } from "@/lib/db/entries";
import type { EntryListParams, EntryListResponse, EntryResponse } from "@/types/api";

/**
 * TanStack Query hooks for the entry read paths. Same query keys, caching, and
 * return shapes as the web app — only the data source changed: each query calls
 * a `lib/db/entries` repository through `useDb` instead of HTTP. The
 * repositories throw the same `ApiError` the UI already handles.
 *
 * The write mutations (create/update/delete) and calendar / on-this-day hooks
 * land in later cycles (12b and beyond).
 */

/**
 * Build a stable filter key for the list query: strip undefined fields and
 * default values so identical filter shapes don't produce different keys.
 */
function normalizeListFilters(options: EntryListParams): EntryListParams {
  const out: EntryListParams = {};
  if (options.limit !== undefined) out.limit = options.limit;
  if (options.offset !== undefined && options.offset !== 0) out.offset = options.offset;
  if (options.order && options.order !== "newest") out.order = options.order;
  if (options.q && options.q.trim().length > 0) out.q = options.q.trim();
  if (options.book) out.book = options.book;
  if (options.tag) out.tag = options.tag;
  if (options.from_date) out.from_date = options.from_date;
  if (options.to_date) out.to_date = options.to_date;
  return out;
}

export function useEntryList(
  options: EntryListParams = {},
): UseQueryResult<EntryListResponse> {
  const db = useDb();
  const normalized = normalizeListFilters(options);
  return useQuery({
    queryKey: ["entries", "list", normalized] as const,
    queryFn: () => listEntries(db, normalized),
  });
}

export function useEntry(entryId: number | undefined): UseQueryResult<EntryResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["entries", "detail", entryId] as const,
    queryFn: () => getEntry(db, entryId as number),
    enabled: typeof entryId === "number" && Number.isFinite(entryId),
  });
}
