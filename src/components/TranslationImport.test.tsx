import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TranslationImport } from "@/components/TranslationImport";
import { ALL_BOOKS } from "@/lib/bible/books";
import { createBetterSqliteExecutor } from "@/lib/db/betterSqliteConnection";
import type { DbExecutor } from "@/lib/db/executor";
import { runMigrations } from "@/lib/db/migrations";
import { useImportTranslation, useTranslations } from "@/hooks/useBible";
import { renderApp } from "@/test/renderApp";

function validText(code = "ESV", name = "English Standard Version"): string {
  return JSON.stringify({
    code,
    name,
    language: "en",
    copyright: "© owner",
    books: ALL_BOOKS.map((spec) => ({
      name: spec.name,
      abbreviation: spec.abbreviation,
      order_index: spec.order_index,
      chapters: [{ number: 1, verses: [{ number: 1, text: `${spec.name} 1:1` }] }],
    })),
  });
}

/** Migrated but empty DB (no translation) so the list starts at zero. */
function emptyDbInitializer(): () => Promise<DbExecutor> {
  return async () => {
    const db = createBetterSqliteExecutor(":memory:");
    await runMigrations(db);
    return db;
  };
}

describe("TranslationImport — static", () => {
  it("lists loaded translations, shows the copyright note and the .json file input", async () => {
    // Default initializer loads the synthetic "TST" translation.
    renderApp(<TranslationImport />);
    const list = await screen.findByTestId("loaded-translations");
    expect(within(list).getAllByText("TST").length).toBeGreaterThan(0);
    expect(screen.getByText(/legal right to use/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Import translation")).toHaveAttribute(
      "accept",
      ".json,application/json",
    );
  });
});

// Harness driving the real hook by feeding text directly (no file dialog).
function Harness(): JSX.Element {
  const imp = useImportTranslation();
  const list = useTranslations();
  return (
    <div>
      <button type="button" onClick={() => imp.mutate(validText())}>
        import
      </button>
      <ul data-testid="codes">
        {(list.data?.translations ?? []).map((t) => (
          <li key={t.code}>{t.code}</li>
        ))}
      </ul>
      {imp.isSuccess && (
        <p data-testid="ok">
          {imp.data.code}:{imp.data.counts.verses}
        </p>
      )}
    </div>
  );
}

describe("useImportTranslation (via harness)", () => {
  it("imports and refreshes the translations list", async () => {
    const user = userEvent.setup();
    renderApp(<Harness />, { initialize: emptyDbInitializer() });

    // Starts empty.
    const codes = await screen.findByTestId("codes");
    expect(within(codes).queryByText("ESV")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "import" }));

    // Success summary carries the counts, and the list refetches to include ESV.
    expect(await screen.findByTestId("ok")).toHaveTextContent("ESV:66");
    await waitFor(() => {
      expect(within(screen.getByTestId("codes")).getByText("ESV")).toBeInTheDocument();
    });
  });
});
