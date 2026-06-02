import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { ALL_BOOKS } from "@/lib/bible/books";
import { createBetterSqliteExecutor } from "@/lib/db/betterSqliteConnection";
import type { DbExecutor } from "@/lib/db/executor";
import { loadTranslation } from "@/lib/db/loadTranslation";
import { runMigrations } from "@/lib/db/migrations";
import { CanonicalTranslationSchema } from "@/lib/schema/canonical";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

// Verse text is prefixed with the code so the two panes are distinguishable
// (e.g. "TST John 1:1" vs "BSB John 1:1").
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

function manyTranslations(codes: string[]): () => Promise<DbExecutor> {
  return async () => {
    const db = createBetterSqliteExecutor(":memory:");
    await runMigrations(db);
    for (const code of codes) await loadTranslation(db, buildTranslation(code));
    return db;
  };
}

function renderReader(path: string, initialize = manyTranslations(["TST", "BSB", "KJV"])) {
  return renderApp(<AppRoutes />, { initialEntries: [path], initialize });
}

const primaryRegion = () => screen.findByRole("region", { name: "Primary translation" });
const comparisonRegion = () => screen.findByRole("region", { name: "Comparison translation" });
const pinText = (region: HTMLElement, text: string) =>
  within(region).findByText(text); // resolves once the pane's chapter has loaded

describe("ReaderPage compare-mode — button", () => {
  it("disables Compare when only one translation is loaded", async () => {
    renderReader("/read/TST/John/1", makeEntriesInitializer([]));
    expect(
      await screen.findByRole("button", { name: /compare translations/i }),
    ).toBeDisabled();
  });

  it("opens two panes and hides the Compare button", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1");
    const compareBtn = await screen.findByRole("button", { name: /compare translations/i });
    await waitFor(() => expect(compareBtn).toBeEnabled()); // wait for translations to load
    await user.click(compareBtn);

    expect(await primaryRegion()).toBeInTheDocument();
    expect(await comparisonRegion()).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /compare translations/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ReaderPage compare-mode — panes", () => {
  it("renders each pane in its own translation", async () => {
    renderReader("/read/TST/John/1?compare=BSB");
    expect(await pinText(await primaryRegion(), "TST John 1:1")).toBeInTheDocument();
    expect(await pinText(await comparisonRegion(), "BSB John 1:1")).toBeInTheDocument();
  });

  it("switches the comparison pane's translation", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    await pinText(await comparisonRegion(), "BSB John 1:1");
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Comparison translation" }),
      "KJV",
    );
    expect(await pinText(await comparisonRegion(), "KJV John 1:1")).toBeInTheDocument();
    expect(await pinText(await primaryRegion(), "TST John 1:1")).toBeInTheDocument();
  });

  it("swaps the panes when the comparison picker selects the primary's code", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    await pinText(await comparisonRegion(), "BSB John 1:1");
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Comparison translation" }),
      "TST",
    );
    // Primary becomes the old comparison (BSB); comparison becomes the old primary (TST).
    expect(await pinText(await primaryRegion(), "BSB John 1:1")).toBeInTheDocument();
    expect(await pinText(await comparisonRegion(), "TST John 1:1")).toBeInTheDocument();
  });

  it("swaps the panes when the primary picker selects the comparison's code", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    await pinText(await primaryRegion(), "TST John 1:1");
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Primary translation" }),
      "BSB",
    );
    expect(await pinText(await primaryRegion(), "BSB John 1:1")).toBeInTheDocument();
    expect(await pinText(await comparisonRegion(), "TST John 1:1")).toBeInTheDocument();
  });

  it("closing the comparison returns to single-pane", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    await pinText(await comparisonRegion(), "BSB John 1:1");
    await user.click(screen.getByRole("button", { name: /close comparison/i }));
    // Single-pane: the Compare button reappears and the comparison region is gone.
    expect(
      await screen.findByRole("button", { name: /compare translations/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Comparison translation" }),
    ).not.toBeInTheDocument();
  });

  it("a verse tap in the comparison pane prefills the new-entry form with that pane's translation", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    const compare = await comparisonRegion();
    await within(compare).findByText("BSB John 1:1");
    await user.click(within(compare).getByTestId("verse-1"));

    // Landed on the new-entry form, prefilled with the COMPARISON translation.
    expect(await screen.findByLabelText("Scripture reference")).toHaveValue("John 1:1");
    expect(screen.getByLabelText("Translation")).toHaveValue("BSB");
  });

  it("preserves ?compare= across book navigation", async () => {
    const user = userEvent.setup();
    renderReader("/read/TST/John/1?compare=BSB");
    await pinText(await primaryRegion(), "TST John 1:1");
    // Wait for the book list to populate before selecting.
    await screen.findByRole("option", { name: "Genesis" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Book" }), "Genesis");

    expect(
      await within(await primaryRegion()).findByRole("heading", { name: "Genesis 1" }),
    ).toBeInTheDocument();
    // Comparison pane still present (compare survived the nav).
    expect(await comparisonRegion()).toBeInTheDocument();
  });
});
