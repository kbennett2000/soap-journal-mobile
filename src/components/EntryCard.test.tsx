import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CompactEntryCard } from "@/components/CompactEntryCard";
import { EntryCard } from "@/components/EntryCard";
import type { EntryResponse } from "@/types/api";

const ENTRY: EntryResponse = {
  id: 7,
  title: "On grace",
  display_title: "On grace",
  entry_date: "2026-05-26",
  scripture_ref: "John 3:16",
  translation_code: "BSB",
  scripture_text: "For God so loved the world…",
  observation: "The world is loved.",
  application: "",
  prayer: "",
  tags: [{ id: 1, name: "faith" }],
  created_at: "2026-05-26T00:00:00.000Z",
  updated_at: "2026-05-26T00:00:00.000Z",
};

function withRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("EntryCard", () => {
  it("links to the entry and shows meta, observation, and tags", () => {
    withRouter(<EntryCard entry={ENTRY} />);
    const link = screen.getByRole("link", { name: "On grace" });
    expect(link).toHaveAttribute("href", "/entries/7");
    expect(screen.getByText(/John 3:16 · 2026-05-26 · BSB/)).toBeInTheDocument();
    expect(screen.getByText("The world is loved.")).toBeInTheDocument();
    expect(screen.getByText("faith")).toBeInTheDocument();
  });
});

describe("CompactEntryCard", () => {
  it("renders a single-line title link + meta", () => {
    withRouter(<CompactEntryCard entry={ENTRY} />);
    const link = screen.getByRole("link", { name: /On grace/ });
    expect(link).toHaveAttribute("href", "/entries/7");
    expect(screen.getByText(/John 3:16 · 2026-05-26/)).toBeInTheDocument();
  });
});
