import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { ALL_BOOKS } from "@/lib/bible/books";
import { createBetterSqliteExecutor } from "@/lib/db/betterSqliteConnection";
import type { DbExecutor } from "@/lib/db/executor";
import { loadTranslation } from "@/lib/db/loadTranslation";
import { runMigrations } from "@/lib/db/migrations";
import { CanonicalTranslationSchema } from "@/lib/schema/canonical";
import { renderApp } from "@/test/renderApp";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

// Cross-ref TARGET is Exodus (order 2) — whose abbreviation differs from its
// name, so navigating by the stored `to_book` abbreviation genuinely exercises
// getChapter's alias resolution.
const EXODUS = ALL_BOOKS.find((b) => b.order_index === 2)!;

/** Genesis 1:1 carries a tn note with a cross-ref to Exodus 1:1. */
function notesInitializer(): () => Promise<DbExecutor> {
  const books = ALL_BOOKS.map((spec) => {
    const chapters =
      spec.order_index === 1
        ? [
            {
              number: 1,
              verses: [
                { number: 1, text: 'In the beginning' },
                { number: 2, text: 'And the earth' },
              ],
              footnotes: [
                {
                  verse_number: 1,
                  text: 'tn the first note',
                  note_type: 'tn',
                  cross_refs: [{ to_book_order_index: 2, to_chapter: 1, to_verse_start: 1 }],
                },
              ],
            },
          ]
        : [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }];
    return {
      name: spec.name,
      abbreviation: spec.abbreviation,
      order_index: spec.order_index,
      chapters,
    };
  });
  const payload = CanonicalTranslationSchema.parse({
    code: 'TST',
    name: 'Test',
    language: 'en',
    copyright: '© test',
    books,
  });
  return async () => {
    const db = createBetterSqliteExecutor(':memory:');
    await runMigrations(db);
    await loadTranslation(db, payload);
    return db;
  };
}

describe("Reader — cross-ref navigation (NET end-to-end)", () => {
  it("a cross-ref chip navigates by the target's abbreviation and resolves the chapter", async () => {
    const user = userEvent.setup();
    renderApp(<AppRoutes />, {
      initialEntries: ["/read/TST/Genesis/1"],
      initialize: notesInitializer(),
    });

    await screen.findByRole("heading", { name: "Genesis 1" });

    // Open the footnote, then click its cross-ref chip.
    await user.click(screen.getByRole("button", { name: "Footnote" }));
    const chip = screen.getByRole("link", { name: `${EXODUS.abbreviation} 1:1` });
    await user.click(chip);

    // Nav resolves the abbreviation alias → the target chapter renders.
    expect(await screen.findByRole("heading", { name: "Exodus 1" })).toBeInTheDocument();
  });
});
