import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { DEFAULT_SEED, makeEntriesInitializer, type SeedEntry } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

function renderList(path = "/entries", seed: SeedEntry[] = DEFAULT_SEED) {
  return renderApp(<AppRoutes />, {
    initialEntries: [path],
    initialize: makeEntriesInitializer(seed),
  });
}

describe("EntryListPage", () => {
  it("renders all seeded entries, newest first, with a total", async () => {
    renderList();
    expect(await screen.findByText("Love defined")).toBeInTheDocument();
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(5);
    // Newest entry (2026-05-26) first.
    expect(within(articles[0]).getByText("Love defined")).toBeInTheDocument();
    expect(screen.getByText(/1–5 of 5/)).toBeInTheDocument();
  });

  it("filters by book (URL param)", async () => {
    renderList("/entries?book=John");
    expect(await screen.findByText("Love defined")).toBeInTheDocument();
    expect(screen.getByText(/1–3 of 3/)).toBeInTheDocument();
    expect(screen.queryByText("Working for good")).not.toBeInTheDocument(); // Romans
  });

  it("filters by tag", async () => {
    renderList("/entries?tag=faith");
    expect(await screen.findByText("Working for good")).toBeInTheDocument();
    expect(screen.getByText(/1–3 of 3/)).toBeInTheDocument();
    expect(screen.queryByText("Shepherd imagery.")).not.toBeInTheDocument(); // Psalms/family
  });

  it("filters by keyword search across fields", async () => {
    renderList("/entries?q=Shepherd");
    expect(await screen.findByText(/1–1 of 1/)).toBeInTheDocument();
    expect(screen.getByText("Shepherd imagery.")).toBeInTheDocument();
  });

  it("filters by date range (inclusive)", async () => {
    renderList("/entries?from_date=2025-01-01&to_date=2026-12-31");
    expect(await screen.findByText(/1–3 of 3/)).toBeInTheDocument();
  });

  it("echoes the canonical book name in the applied-filter chips", async () => {
    renderList("/entries?book=Jn");
    const chips = await screen.findByTestId("applied-filter-chips");
    expect(within(chips).getByText("John")).toBeInTheDocument();
  });

  it("surfaces INVALID_BOOK", async () => {
    renderList("/entries?book=Frodo");
    expect(await screen.findByRole("alert")).toHaveTextContent(/unknown book/i);
  });

  it("surfaces INVALID_DATE_RANGE", async () => {
    renderList("/entries?from_date=2025-12-31&to_date=2025-01-01");
    expect(await screen.findByRole("alert")).toHaveTextContent(/after to_date/i);
  });

  it("shows the empty state when there are no entries", async () => {
    renderList("/entries", []);
    expect(await screen.findByTestId("entries-empty")).toBeInTheDocument();
  });

  it("paginates", async () => {
    const user = userEvent.setup();
    renderList("/entries?limit=2");
    expect(await screen.findByText(/1–2 of 5/)).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText(/3–4 of 5/)).toBeInTheDocument();
  });

  it("narrows via the FilterBar (book select)", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Love defined");
    await user.selectOptions(screen.getByLabelText("Book"), "Romans");
    expect(await screen.findByText(/1–1 of 1/)).toBeInTheDocument();
    expect(screen.getByText("Working for good")).toBeInTheDocument();
  });
});
