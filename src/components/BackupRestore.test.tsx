import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BackupRestore } from "@/components/BackupRestore";
import { renderApp } from "@/test/renderApp";

describe("BackupRestore", () => {
  it("renders the export button, the journal-only scope note, and the restore stub", async () => {
    renderApp(<BackupRestore />);
    expect(
      await screen.findByRole("button", { name: "Export backup" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bible text isn['’]t included/i)).toBeInTheDocument();
    expect(screen.getByText(/coming next/i)).toBeInTheDocument();
  });
});
