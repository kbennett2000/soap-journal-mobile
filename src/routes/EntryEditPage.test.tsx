import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { getEntry, listEntries } from "@/lib/db/entries";
import { makeCapturingEntriesInitializer, type SeedEntry } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

const ONE: SeedEntry[] = [
  {
    input: {
      scripture_ref: "John 1:1",
      title: "Original",
      observation: "old observation",
      tags: ["faith"],
      entry_date: "2026-05-01",
    },
  },
];

describe("EntryEditPage", () => {
  it("pre-fills the form from the loaded entry", async () => {
    const cap = makeCapturingEntriesInitializer(ONE);
    renderApp(<AppRoutes />, { initialEntries: ["/entries/1/edit"], initialize: cap.initialize });

    expect(await screen.findByLabelText("Title")).toHaveValue("Original");
    expect(screen.getByLabelText("Scripture reference")).toHaveValue("John 1:1");
    expect(screen.getByLabelText("Observation")).toHaveValue("old observation");
    expect(screen.getByText("faith")).toBeInTheDocument();
  });

  it("saves an update (round-trip via the real repos)", async () => {
    const user = userEvent.setup();
    const cap = makeCapturingEntriesInitializer(ONE);
    renderApp(<AppRoutes />, { initialEntries: ["/entries/1/edit"], initialize: cap.initialize });

    const obs = await screen.findByLabelText("Observation");
    await user.clear(obs);
    await user.type(obs, "new observation");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // Navigated to the detail page.
    expect(await screen.findByRole("heading", { name: "Original" })).toBeInTheDocument();
    const entry = await getEntry(cap.db(), 1);
    expect(entry.observation).toBe("new observation");
  });

  it("deletes via the ConfirmDialog and navigates to the list", async () => {
    const user = userEvent.setup();
    const cap = makeCapturingEntriesInitializer(ONE);
    renderApp(<AppRoutes />, { initialEntries: ["/entries/1/edit"], initialize: cap.initialize });

    await user.click(await screen.findByRole("button", { name: "Delete entry" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByTestId("entries-empty")).toBeInTheDocument();
    const list = await listEntries(cap.db(), {});
    expect(list.total).toBe(0);
  });

  it("shows the not-found panel for a missing entry", async () => {
    const cap = makeCapturingEntriesInitializer(ONE);
    renderApp(<AppRoutes />, { initialEntries: ["/entries/9999/edit"], initialize: cap.initialize });
    expect(await screen.findByTestId("entry-not-found")).toBeInTheDocument();
  });
});
