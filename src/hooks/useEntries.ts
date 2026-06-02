import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import {
  calendar,
  deleteEntry,
  getEntry,
  listEntries,
  onThisDay,
  saveEntry,
} from "@/lib/db/entries";
import type {
  CalendarResponse,
  EntryCreateRequest,
  EntryListParams,
  EntryListResponse,
  EntryResponse,
  OnThisDayResponse,
} from "@/types/api";

/**
 * TanStack Query hooks for the entries feature. Same query keys, caching, and
 * return shapes as the web app — only the data source changed: each query /
 * mutation calls a `lib/db/entries` repository through `useDb` instead of HTTP.
 * The repositories throw the same `ApiError` the UI already handles.
 *
 * Calendar / on-this-day hooks (`useCalendar`/`useOnThisDay`) land with those
 * pages in a later cycle; their invalidation keys are already emitted here so
 * those views refresh correctly once built (matches the web hook).
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

/**
 * "On this day in previous years" for the dashboard. Same query key/shape as
 * the web app; the data source is the cycle-7b `onThisDay` repository via
 * `useDb`. Invalidated by `invalidateAllEntryViews` on every entry mutation.
 */
export function useOnThisDay(
  date?: string,
  yearsBack?: number,
): UseQueryResult<OnThisDayResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["entries", "onThisDay", date ?? null, yearsBack ?? null] as const,
    queryFn: () => onThisDay(db, date, yearsBack),
    staleTime: 60_000,
  });
}

/**
 * Per-day entry counts for a month, for the calendar grid. Same query
 * key/shape as the web app; the data source is the cycle-7b `calendar`
 * repository via `useDb`. Invalidated by `invalidateAllEntryViews`.
 */
export function useCalendar(
  year: number,
  month: number,
): UseQueryResult<CalendarResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["entries", "calendar", year, month] as const,
    queryFn: () => calendar(db, year, month),
    staleTime: 60_000,
  });
}

/**
 * Invalidate every view that could reflect an entry change. Mirrors the web
 * hook's invalidation set: list + calendar + on-this-day + the reader's
 * passage-entries badge + the tag list (tags are get-or-created on save).
 */
function invalidateAllEntryViews(
  qc: ReturnType<typeof useQueryClient>,
): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["entries", "list"] }),
    qc.invalidateQueries({ queryKey: ["entries", "calendar"] }),
    qc.invalidateQueries({ queryKey: ["entries", "onThisDay"] }),
    qc.invalidateQueries({ queryKey: ["bible", "passageEntries"] }),
    qc.invalidateQueries({ queryKey: ["tags", "list"] }),
  ]).then(() => undefined);
}

/**
 * Create (no `entryId`) or update (with `entryId`) an entry. The web app's
 * separate `useCreateEntry`/`useUpdateEntry` collapse onto the single
 * `saveEntry(db, input, entryId?)` repository call. On success, refresh all
 * entry views; for an update also refresh that entry's detail cache.
 */
export function useSaveEntry(entryId?: number) {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EntryCreateRequest) => saveEntry(db, input, entryId),
    onSuccess: async () => {
      await invalidateAllEntryViews(qc);
      if (entryId !== undefined) {
        await qc.invalidateQueries({ queryKey: ["entries", "detail", entryId] });
      }
    },
  });
}

export function useDeleteEntry() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) => deleteEntry(db, entryId),
    onSuccess: async () => {
      await invalidateAllEntryViews(qc);
    },
  });
}
