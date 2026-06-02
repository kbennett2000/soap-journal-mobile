import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { ALL_BOOKS } from "@/lib/bible/books";
import { createBetterSqliteExecutor } from "@/lib/db/betterSqliteConnection";
import { saveEntry } from "@/lib/db/entries";
import type { DbExecutor } from "@/lib/db/executor";
import { loadTranslation } from "@/lib/db/loadTranslation";
import { runMigrations } from "@/lib/db/migrations";
import { CanonicalTranslationSchema } from "@/lib/schema/canonical";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("Reader verse→entry flow", () => {
  it("navigates to the pre-filled new-entry form when a verse is clicked", async () => {
    const user = userEvent.setup();
    renderApp(<AppRoutes />, {
      initialEntries: ["/read/TST/Genesis/1"],
      initialize: makeEntriesInitializer([]),
    });

    await screen.findByRole("heading", { name: "Genesis 1" });
    // Verses are clickable buttons once onVerseClick is wired.
    await user.click(screen.getByTestId("verse-2"));

    // Lands on the new-entry form, pre-filled with the verse reference.
    expect(await screen.findByRole("heading", { name: "New entry" })).toBeInTheDocument();
    expect(screen.getByLabelText("Scripture reference")).toHaveValue("Genesis 1:2");
  });
});

describe("PassageEntriesBadge in the reader", () => {
  it("shows the count and expands to list entries on the passage", async () => {
    const user = userEvent.setup();
    renderApp(<AppRoutes />, {
      initialEntries: ["/read/TST/John/1"],
      initialize: makeEntriesInitializer([
        { input: { scripture_ref: "John 1:1", title: "John note" } },
      ]),
    });

    const badge = await screen.findByTestId("passage-entries-badge");
    expect(within(badge).getByText("1 entry on this chapter")).toBeInTheDocument();
    await user.click(within(badge).getByRole("button"));
    expect(await screen.findByText("John note")).toBeInTheDocument();
  });

  it("renders nothing when there are no entries on the passage", async () => {
    renderApp(<AppRoutes />, {
      initialEntries: ["/read/TST/Genesis/1"],
      initialize: makeEntriesInitializer([]),
    });
    await screen.findByRole("heading", { name: "Genesis 1" });
    expect(screen.queryByTestId("passage-entries-badge")).not.toBeInTheDocument();
  });

  it("matches across translations (Model B): journaled in TST, shown reading BSB", async () => {
    renderApp(<AppRoutes />, {
      initialEntries: ["/read/BSB/John/1"],
      initialize: twoTranslationInitializer,
    });

    const badge = await screen.findByTestId("passage-entries-badge");
    // The entry was journaled with translation_code "TST"; reading in "BSB"
    // still surfaces it because matching is by canonical coordinates.
    expect(within(badge).getByText("1 entry on this chapter")).toBeInTheDocument();
  });
});

// --- helpers ---------------------------------------------------------------

function buildTranslation(code: string) {
  const overrides: Record<string, { number: number; text: string }[]> = {
    Genesis: [1, 2, 3, 4, 5].map((n) => ({ number: n, text: `${code} Gen 1:${n}` })),
    John: [1, 2, 3].map((n) => ({ number: n, text: `${code} John 1:${n}` })),
  };
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: [
      { number: 1, verses: overrides[spec.name] ?? [{ number: 1, text: `${spec.name} 1:1` }] },
    ],
  }));
  return CanonicalTranslationSchema.parse({
    code,
    name: code,
    language: "en",
    copyright: `© ${code}`,
    books,
  });
}

async function twoTranslationInitializer(): Promise<DbExecutor> {
  const db = createBetterSqliteExecutor(":memory:");
  await runMigrations(db);
  await loadTranslation(db, buildTranslation("TST"));
  await loadTranslation(db, buildTranslation("BSB"));
  // Journal the passage in TST.
  await saveEntry(
    db,
    { scripture_ref: "John 1:1", translation_code: "TST", title: "Cross note" },
    undefined,
    "2026-06-02T12:00:00.000Z",
  );
  return db;
}
