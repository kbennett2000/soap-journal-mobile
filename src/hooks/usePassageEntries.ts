import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { getPassageEntries } from "@/lib/db/entries";
import type { PassageEntriesResponse } from "@/types/api";

/**
 * Used by the reader to surface "you have N entries on this passage." The hook
 * keys on (ref, translationCode) so every chapter / range gets its own cache
 * slot. Invalidated on every entry mutation (see `useEntries`
 * `invalidateAllEntryViews`).
 *
 * Model B: the underlying `getPassageEntries` matches by canonical coordinates
 * and is translation-agnostic — an entry journaled in one translation surfaces
 * when reading the passage in another. The `translationCode` here only scopes
 * the reference resolution, not which entries match.
 */
export function usePassageEntries(
  ref: string | undefined,
  translationCode: string | undefined,
): UseQueryResult<PassageEntriesResponse> {
  const db = useDb();
  const trimmed = (ref ?? "").trim();
  return useQuery({
    queryKey: ["bible", "passageEntries", trimmed, translationCode ?? null] as const,
    queryFn: () => getPassageEntries(db, trimmed, translationCode),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}
