import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntryFormScripturePreview } from "@/components/EntryFormScripturePreview";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// The synthetic translation (TST) has Genesis 1:1–5 and John 1:1–3.
function renderPreview(scriptureRef: string, translationCode = "TST") {
  return renderApp(
    <EntryFormScripturePreview scriptureRef={scriptureRef} translationCode={translationCode} />,
    { initialize: makeEntriesInitializer([]) },
  );
}

describe("EntryFormScripturePreview", () => {
  it("renders none of the preview states for an empty reference", () => {
    renderPreview("");
    // The component returns null for an empty ref — no loading/success/error.
    expect(screen.queryByTestId("scripture-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scripture-preview-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scripture-preview-error")).not.toBeInTheDocument();
  });

  it("shows the canonical string and joined verse text for a valid reference", async () => {
    renderPreview("Genesis 1:2-3");
    expect(await screen.findByTestId("scripture-preview")).toBeInTheDocument();
    expect(screen.getByText("Genesis 1:2-3")).toBeInTheDocument();
    // Verses joined as "N text".
    expect(screen.getByText(/2 Gen 1:2 3 Gen 1:3/)).toBeInTheDocument();
  });

  it("surfaces an error for an invalid reference", async () => {
    renderPreview("Frodo 3:16");
    const alert = await screen.findByTestId("scripture-preview-error");
    expect(alert).toHaveTextContent(/unknown book/i);
  });
});
