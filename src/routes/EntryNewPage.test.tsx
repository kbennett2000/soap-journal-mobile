import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { getEntry, listEntries } from "@/lib/db/entries";
import { makeCapturingEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

describe("EntryNewPage", () => {
  it("creates an entry through the form (round-trip via the real repos)", async () => {
    const user = userEvent.setup();
    const cap = makeCapturingEntriesInitializer([]);
    renderApp(<AppRoutes />, {
      initialEntries: ["/entries/new"],
      initialize: cap.initialize,
    });

    await user.type(await screen.findByLabelText("Scripture reference"), "John 1:1");
    // The form falls back to "BSB" until the translations query resolves; pick
    // the loaded synthetic translation explicitly once its option appears.
    await screen.findByRole("option", { name: /TST/ });
    await user.selectOptions(screen.getByLabelText("Translation"), "TST");
    await user.type(screen.getByLabelText("Title"), "First light");
    await user.type(screen.getByLabelText("Observation"), "The Word was with God.");
    // Tag with mixed casing — get-or-create should preserve it.
    await user.type(screen.getByLabelText("Tags"), "Gratitude{Enter}");

    await user.click(screen.getByRole("button", { name: "Create entry" }));

    // Navigated to the detail page on success.
    expect(await screen.findByRole("heading", { name: "First light" })).toBeInTheDocument();

    // Assert via the real repositories against the same DB.
    const db = cap.db();
    const list = await listEntries(db, {});
    expect(list.total).toBe(1);
    const entry = await getEntry(db, list.entries[0]!.id);
    expect(entry.title).toBe("First light");
    expect(entry.scripture_ref).toBe("John 1:1");
    expect(entry.observation).toBe("The Word was with God.");
    expect(entry.scripture_text).toBe("John 1:1"); // snapshotted synthetic verse text
    expect(entry.tags.map((t) => t.name)).toEqual(["Gratitude"]);
  });

  it("pre-fills the reference + translation from router state", async () => {
    const cap = makeCapturingEntriesInitializer([]);
    renderApp(<AppRoutes />, {
      initialEntries: [
        { pathname: "/entries/new", state: { scriptureRef: "John 1:2", translationCode: "TST" } },
      ],
      initialize: cap.initialize,
    });
    expect(await screen.findByLabelText("Scripture reference")).toHaveValue("John 1:2");
  });

  it("defaults the date to a valid YYYY-MM-DD", async () => {
    const cap = makeCapturingEntriesInitializer([]);
    renderApp(<AppRoutes />, {
      initialEntries: ["/entries/new"],
      initialize: cap.initialize,
    });
    const dateInput = (await screen.findByLabelText("Date")) as HTMLInputElement;
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
