import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilterBar, type FilterValues } from "@/components/FilterBar";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

const EMPTY: FilterValues = { q: "", book: "", tag: "", fromDate: "", toDate: "" };

// Seed one tagged entry so the tag dropdown has an option and the translation
// (hence the book dropdown) is loaded.
function renderFilterBar(onChange = vi.fn()) {
  const initialize = makeEntriesInitializer([
    { input: { scripture_ref: "Genesis 1:1", tags: ["faith"] } },
  ]);
  renderApp(<FilterBar values={EMPTY} onChange={onChange} />, { initialize });
  return onChange;
}

describe("FilterBar", () => {
  it("populates the book and tag dropdowns from the loaded data", async () => {
    renderFilterBar();
    // Book options come from the loaded translation.
    expect(await screen.findByRole("option", { name: "Genesis" })).toBeInTheDocument();
    // Tag option comes from the seeded entry's tag.
    expect(await screen.findByRole("option", { name: "faith" })).toBeInTheDocument();
  });

  it("fires onChange when a book is selected", async () => {
    const onChange = renderFilterBar();
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Genesis" });
    await user.selectOptions(screen.getByLabelText("Book"), "Genesis");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ book: "Genesis" }));
  });

  it("fires onChange with the search text", async () => {
    const onChange = renderFilterBar();
    const user = userEvent.setup();
    await screen.findByRole("option", { name: "Genesis" });
    const input = screen.getByLabelText("Search");
    await user.type(input, "love{Enter}");
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: "love" }));
    });
  });
});
