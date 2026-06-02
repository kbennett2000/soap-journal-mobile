import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { listEntries } from "@/lib/db/entries";
import {
  makeCapturingEntriesInitializer,
  makeEntriesInitializer,
  type SeedEntry,
} from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// A single fully-populated entry; seeded first, so it gets id 1.
const ONE: SeedEntry[] = [
  {
    input: {
      scripture_ref: "Genesis 1:2",
      title: "On creation",
      observation: "God spoke.",
      application: "Listen.",
      prayer: "Open my ears.",
      tags: ["faith", "wonder"],
      entry_date: "2026-05-26",
    },
  },
];

describe("EntryDetailPage", () => {
  it("renders all SOAP fields, tags, snapshot text, translation, and reader link", async () => {
    renderApp(<AppRoutes />, {
      initialEntries: ["/entries/1"],
      initialize: makeEntriesInitializer(ONE),
    });

    expect(await screen.findByRole("heading", { name: "On creation" })).toBeInTheDocument();
    // Meta: scripture_ref · date · translation_code (off the entry — Model B).
    // The ref appears twice (header meta + the scripture-section label).
    expect(screen.getAllByText("Genesis 1:2").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-05-26")).toBeInTheDocument();
    expect(screen.getByText("TST")).toBeInTheDocument();
    // Snapshotted scripture text (the verse text at save time).
    expect(screen.getByText("Gen 1:2")).toBeInTheDocument();
    // SOAP fields.
    expect(screen.getByText("God spoke.")).toBeInTheDocument();
    expect(screen.getByText("Listen.")).toBeInTheDocument();
    expect(screen.getByText("Open my ears.")).toBeInTheDocument();
    // Tags.
    expect(screen.getByText("faith")).toBeInTheDocument();
    expect(screen.getByText("wonder")).toBeInTheDocument();
    // Read-only "Open in reader" link to the canonical range.
    expect(screen.getByRole("link", { name: "Open in reader" })).toHaveAttribute(
      "href",
      "/read/TST/Genesis/1?range=2",
    );
  });

  it("shows the not-found panel for a missing entry", async () => {
    renderApp(<AppRoutes />, {
      initialEntries: ["/entries/9999"],
      initialize: makeEntriesInitializer(ONE),
    });
    expect(await screen.findByTestId("entry-not-found")).toBeInTheDocument();
  });

  it("links to the edit page", async () => {
    renderApp(<AppRoutes />, {
      initialEntries: ["/entries/1"],
      initialize: makeEntriesInitializer(ONE),
    });
    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/entries/1/edit",
    );
  });

  it("deletes via the ConfirmDialog and navigates to the list", async () => {
    const user = userEvent.setup();
    const cap = makeCapturingEntriesInitializer(ONE);
    renderApp(<AppRoutes />, { initialEntries: ["/entries/1"], initialize: cap.initialize });

    await user.click(await screen.findByRole("button", { name: "Delete" }));
    // ConfirmDialog's destructive confirm button (scoped to the dialog so it
    // doesn't collide with the footer "Delete" trigger).
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByTestId("entries-empty")).toBeInTheDocument();
    const list = await listEntries(cap.db(), {});
    expect(list.total).toBe(0);
  });
});
