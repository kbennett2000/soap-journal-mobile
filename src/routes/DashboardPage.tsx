import { Link, useNavigate } from "react-router-dom";

import { CompactEntryCard } from "@/components/CompactEntryCard";
import { JumpBar } from "@/components/reader/JumpBar";
import { useTranslations } from "@/hooks/useBible";
import { useEntryList, useOnThisDay } from "@/hooks/useEntries";
import { ApiError } from "@/lib/db/errors";
import type { ResolvedReference } from "@/types/api";

/**
 * Landing page. Recent entries, "on this day in previous years," a
 * jump-to-passage bar, and a new-entry CTA — all over the `lib/db`
 * repositories via the `useDb` seam.
 *
 * Mobile adaptations vs the web app: no user/greeting (single local user), and
 * the in-page reader/calendar nav links are dropped — the bottom tab bar
 * already covers those. The "+ New entry" CTA stays (there's no tab for it).
 */
export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const recentQuery = useEntryList({ limit: 5, order: "newest" });
  const onThisDayQuery = useOnThisDay();
  const translationsQuery = useTranslations();
  const defaultCode = translationsQuery.data?.translations[0]?.code ?? "BSB";

  function handleResolved(ref: ResolvedReference): void {
    const range = `?range=${ref.start_verse}-${ref.end_verse}`;
    navigate(
      `/read/${encodeURIComponent(ref.translation_code)}/${encodeURIComponent(
        ref.book.name,
      )}/${ref.chapter_number}${range}`,
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
          Jump to a passage
        </h2>
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[14rem] flex-1">
            <JumpBar translationCode={defaultCode} onResolved={handleResolved} />
          </div>
          <Link
            to="/entries/new"
            className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            + New entry
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="dash-recent-heading"
          className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="dash-recent-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
            >
              Recent entries
            </h2>
            <Link
              to="/entries"
              className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
            >
              View all →
            </Link>
          </div>
          {recentQuery.isLoading && (
            <div data-testid="dash-recent-loading" className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          )}
          {recentQuery.isError && (
            <div
              role="alert"
              data-testid="dash-recent-error"
              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
            >
              {recentQuery.error instanceof ApiError
                ? recentQuery.error.message
                : "Couldn't load recent entries."}
            </div>
          )}
          {recentQuery.data && recentQuery.data.entries.length === 0 && (
            <div
              data-testid="dash-recent-empty"
              className="text-sm text-slate-600 dark:text-slate-300"
            >
              No entries yet.{" "}
              <Link
                to="/entries/new"
                className="font-medium underline-offset-2 hover:underline"
              >
                Start your first entry.
              </Link>
            </div>
          )}
          {recentQuery.data && recentQuery.data.entries.length > 0 && (
            <div className="space-y-2">
              {recentQuery.data.entries.map((entry) => (
                <CompactEntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </section>

        <section
          aria-labelledby="dash-onthisday-heading"
          className="rounded-md border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-3">
            <h2
              id="dash-onthisday-heading"
              className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
            >
              On this day in previous years
            </h2>
            {onThisDayQuery.data?.target_date && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatTargetDate(onThisDayQuery.data.target_date)}
              </p>
            )}
          </div>
          {onThisDayQuery.isLoading && (
            <div data-testid="dash-onthisday-loading" className="space-y-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
                />
              ))}
            </div>
          )}
          {onThisDayQuery.isError && (
            <div
              role="alert"
              data-testid="dash-onthisday-error"
              className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
            >
              {onThisDayQuery.error instanceof ApiError
                ? onThisDayQuery.error.message
                : "Couldn't load on-this-day entries."}
            </div>
          )}
          {onThisDayQuery.data && onThisDayQuery.data.entries.length === 0 && (
            <div
              data-testid="dash-onthisday-empty"
              className="text-sm text-slate-600 dark:text-slate-300"
            >
              Nothing from prior years on this date.
            </div>
          )}
          {onThisDayQuery.data && onThisDayQuery.data.entries.length > 0 && (
            <div className="space-y-2">
              {onThisDayQuery.data.entries.map((entry) => (
                <CompactEntryCard key={entry.id} entry={entry} showYear />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatTargetDate(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const monthNum = Number.parseInt(parts[1] ?? "", 10);
  const dayNum = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(monthNum) || !Number.isFinite(dayNum)) return iso;
  const monthName =
    [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ][monthNum - 1] ?? "";
  return `${monthName} ${dayNum}`;
}
