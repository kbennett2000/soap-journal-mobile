import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useDb } from "@/hooks/useDb";
import { getChapter, getTranslationDetail, listTranslations } from "@/lib/db/bible";
import type {
  ChapterResponse,
  TranslationDetailResponse,
  TranslationListResponse,
} from "@/types/api";

/**
 * TanStack Query hooks for the reader's read-paths.
 *
 * Same query keys, caching, and return shapes as the web app — only the data
 * source changed: each query calls a `lib/db/bible` repository through the
 * `useDb` executor instead of HTTP. The repositories throw the same `ApiError`
 * the UI already handles.
 *
 * Bible content doesn't change between page loads, so chapter and
 * translation-detail queries use `staleTime: Infinity`. The translation list
 * uses a 5-min stale time in case a translation is imported while browsing.
 */

const FIVE_MIN = 5 * 60 * 1_000;

export function useTranslations(): UseQueryResult<TranslationListResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["bible", "translations"] as const,
    queryFn: () => listTranslations(db),
    staleTime: FIVE_MIN,
  });
}

export function useTranslationDetail(
  code: string | undefined,
): UseQueryResult<TranslationDetailResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["bible", "translation", code] as const,
    queryFn: () => getTranslationDetail(db, code as string),
    enabled: typeof code === "string" && code.length > 0,
    staleTime: Infinity,
  });
}

export function useChapter(
  code: string | undefined,
  bookName: string | undefined,
  chapterNumber: number | undefined,
): UseQueryResult<ChapterResponse> {
  const db = useDb();
  return useQuery({
    queryKey: ["bible", "chapter", code, bookName, chapterNumber] as const,
    queryFn: () =>
      getChapter(db, code as string, bookName as string, chapterNumber as number),
    enabled:
      typeof code === "string" &&
      typeof bookName === "string" &&
      typeof chapterNumber === "number" &&
      chapterNumber >= 1,
    staleTime: Infinity,
  });
}
