/**
 * Tag read repository — list + autocomplete.
 *
 * The local-SQLite counterpart of the server's `api/tags.py`. Returns the same
 * shapes the ported `useTags` hook consumes. Tags are created implicitly during
 * entry saves (see `entries.ts` — cycle 7a); these endpoints are read-only.
 *
 * Model B: no `user_id` — tags are globally unique via the `name_lower`
 * generated column.
 */

import type { TagAutocompleteResponse, TagListResponse, TagSummary } from '@/types/api'

import type { DbExecutor } from './executor'

/** Escape SQL LIKE wildcards so the autocomplete needle stays a literal prefix. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

export async function listTags(executor: DbExecutor): Promise<TagListResponse> {
  // One grouped query: tags LEFT JOIN entry_tags, count per tag.
  const tags = await executor.query<TagSummary>(
    `SELECT t.id, t.name, COUNT(et.entry_id) AS entry_count
       FROM tags t
       LEFT JOIN entry_tags et ON et.tag_id = t.id
      GROUP BY t.id
      ORDER BY lower(t.name) ASC`,
  )
  return { tags }
}

export async function autocompleteTags(
  executor: DbExecutor,
  q: string,
): Promise<TagAutocompleteResponse> {
  const needle = q.trim().toLowerCase()
  if (needle === '') {
    // The server returns 422 for empty/whitespace-only q (a framework concern);
    // a repository has no such layer, so an empty needle yields no matches.
    return { tags: [] }
  }

  const tags = await executor.query<TagSummary>(
    `SELECT t.id, t.name, COUNT(et.entry_id) AS entry_count
       FROM tags t
       LEFT JOIN entry_tags et ON et.tag_id = t.id
      WHERE t.name_lower LIKE ? ESCAPE '\\'
      GROUP BY t.id
      ORDER BY COUNT(et.entry_id) DESC, lower(t.name) ASC
      LIMIT 10`,
    [`${escapeLike(needle)}%`],
  )
  return { tags }
}
