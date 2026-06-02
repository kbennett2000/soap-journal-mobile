import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { listTags } from "@/lib/db/tags";
import type { TagListResponse } from "@/types/api";

/**
 * Tag list for the filter dropdown. Same query key/shape as the web app; the
 * data source is the cycle-8 `listTags` repository via `useDb`.
 *
 * `useTagAutocomplete` (for the entry form's TagInput) lands with the write
 * path in cycle 12b.
 */
export function useTagList(): UseQueryResult<TagListResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["tags", "list"] as const,
    queryFn: () => listTags(db),
  });
}
