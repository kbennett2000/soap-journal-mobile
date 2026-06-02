import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { BackupRestore } from "@/components/BackupRestore";
import { useEntryList } from "@/hooks/useEntries";
import { useRestoreBackup } from "@/hooks/useBackup";
import { parseBackup, RestoreError } from "@/lib/db/journalRestore";
import type { Backup } from "@/lib/schema/backup";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// A backup carrying a single entry titled "New" (verbatim — no translation needed).
const NEW_BACKUP: Backup = {
  format: "soap-journal-backup",
  version: 1,
  exported_at: "2026-06-02T00:00:00.000Z",
  entries: [
    {
      title: "New",
      entry_date: "2026-05-20",
      scripture_ref: "John 3:16",
      scripture_translation_code: "ESV",
      scripture_text: "For God so loved the world",
      observation: "",
      application: "",
      prayer: "",
      created_at: "2026-05-20T08:00:00.000Z",
      updated_at: "2026-05-20T08:00:00.000Z",
      verses: [{ book_order_index: 43, chapter: 3, verse: 16 }],
      tags: ["faith"],
    },
  ],
};

describe("BackupRestore — static", () => {
  it("renders the export + restore controls and the journal-only scope note", async () => {
    renderApp(<BackupRestore />);
    expect(await screen.findByRole("button", { name: "Export backup" })).toBeInTheDocument();
    expect(screen.getByLabelText("Restore from backup")).toHaveAttribute(
      "accept",
      ".json,application/json",
    );
    expect(screen.getByText(/Bible text isn['’]t included/i)).toBeInTheDocument();
  });
});

// Harness mirrors the component's validate-before-destroy flow, feeding text
// directly (no native file dialog): parse → on success mutate, on error show it.
function RestoreHarness({ text }: { text: string }): JSX.Element {
  const restore = useRestoreBackup();
  const list = useEntryList({});
  const [err, setErr] = useState<string | null>(null);
  function go(): void {
    try {
      restore.mutate(parseBackup(text));
    } catch (e) {
      setErr(e instanceof RestoreError ? e.message : "unknown");
    }
  }
  return (
    <div>
      <button type="button" onClick={go}>
        restore
      </button>
      {err && <p data-testid="err">{err}</p>}
      <ul data-testid="titles">
        {(list.data?.entries ?? []).map((e) => (
          <li key={e.id}>{e.display_title}</li>
        ))}
      </ul>
    </div>
  );
}

describe("useRestoreBackup (via harness)", () => {
  it("replaces the journal and refreshes the entry list", async () => {
    const user = userEvent.setup();
    renderApp(<RestoreHarness text={JSON.stringify(NEW_BACKUP)} />, {
      initialize: makeEntriesInitializer([
        { input: { scripture_ref: "John 1:1", title: "Old" } },
      ]),
    });

    const titles = await screen.findByTestId("titles");
    await waitFor(() => expect(within(titles).getByText("Old")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "restore" }));

    await waitFor(() => {
      expect(within(screen.getByTestId("titles")).getByText("New")).toBeInTheDocument();
    });
    expect(within(screen.getByTestId("titles")).queryByText("Old")).not.toBeInTheDocument();
  });

  it("surfaces a validation error without mutating the journal", async () => {
    const user = userEvent.setup();
    renderApp(<RestoreHarness text={"not valid json {"} />, {
      initialize: makeEntriesInitializer([
        { input: { scripture_ref: "John 1:1", title: "Old" } },
      ]),
    });

    const titles = await screen.findByTestId("titles");
    await waitFor(() => expect(within(titles).getByText("Old")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "restore" }));

    expect(await screen.findByTestId("err")).toBeInTheDocument();
    // Journal untouched.
    expect(within(screen.getByTestId("titles")).getByText("Old")).toBeInTheDocument();
  });
});
