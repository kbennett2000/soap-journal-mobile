import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { autocompleteTags, listTags } from "@/lib/db/tags";
import type { TagAutocompleteResponse, TagListResponse } from "@/types/api";

/**
 * Tag hooks. Same query keys/shapes as the web app; the data source is the
 * cycle-8 `lib/db/tags` repository via `useDb`.
 */

/** Tag list for the filter dropdown. */
export function useTagList(): UseQueryResult<TagListResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["tags", "list"] as const,
    queryFn: () => listTags(db),
  });
}

/** Prefix autocomplete for the entry form's TagInput. */
export function useTagAutocomplete(
  q: string,
): UseQueryResult<TagAutocompleteResponse> {
  const db = useDb();
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["tags", "autocomplete", trimmed] as const,
    queryFn: () => autocompleteTags(db, trimmed),
    enabled: trimmed.length > 0,
    staleTime: 30_000,
  });
}
