import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { TagInput } from "@/components/TagInput";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// Stateful harness so onChange feeds back into value (TagInput is controlled).
function Harness({ initial = [] as string[] }): JSX.Element {
  const [tags, setTags] = useState<string[]>(initial);
  return (
    <div>
      <TagInput value={tags} onChange={setTags} maxTagLength={50} />
      <output data-testid="tags">{tags.join(",")}</output>
    </div>
  );
}

// Seed an entry tagged "faithfulness" so the autocomplete query has data.
function renderTagInput(initial: string[] = []) {
  return renderApp(<Harness initial={initial} />, {
    initialize: makeEntriesInitializer([
      { input: { scripture_ref: "Genesis 1:1", tags: ["faithfulness"] } },
    ]),
  });
}

const tagsOf = () => screen.getByTestId("tags").textContent;
// Wait past the DbProvider "Loading…" gate before interacting.
const tagInput = () => screen.findByLabelText("Tags");

describe("TagInput", () => {
  it("adds a tag on Enter", async () => {
    const user = userEvent.setup();
    renderTagInput();
    await user.type(await tagInput(), "grace{Enter}");
    expect(tagsOf()).toBe("grace");
  });

  it("adds a tag on comma and clears the input", async () => {
    const user = userEvent.setup();
    renderTagInput();
    const input = await tagInput();
    await user.type(input, "grace,");
    expect(tagsOf()).toBe("grace");
    expect(input).toHaveValue("");
  });

  it("removes the last tag on Backspace from an empty input", async () => {
    const user = userEvent.setup();
    renderTagInput(["faith", "grace"]);
    await user.type(await tagInput(), "{Backspace}");
    expect(tagsOf()).toBe("faith");
  });

  it("de-duplicates case-insensitively, keeping the first casing", async () => {
    const user = userEvent.setup();
    renderTagInput(["Faith"]);
    await user.type(await tagInput(), "faith{Enter}");
    expect(tagsOf()).toBe("Faith");
  });

  it("ignores a whitespace-only Enter", async () => {
    const user = userEvent.setup();
    renderTagInput();
    await user.type(await tagInput(), "   {Enter}");
    expect(tagsOf()).toBe("");
  });

  it("shows autocomplete suggestions and adds one on click", async () => {
    const user = userEvent.setup();
    renderTagInput();
    await user.type(await tagInput(), "fai");
    const option = await screen.findByRole("option", { name: /faithfulness/ });
    await user.click(option);
    expect(tagsOf()).toBe("faithfulness");
  });

  it("removes a tag via its × button", async () => {
    const user = userEvent.setup();
    renderTagInput(["faith", "grace"]);
    await tagInput();
    await user.click(screen.getByRole("button", { name: "Remove tag faith" }));
    expect(tagsOf()).toBe("grace");
  });

  it("shows a hint and does not add a tag over the max length", async () => {
    const user = userEvent.setup();
    renderTagInput();
    await user.type(await tagInput(), `${"x".repeat(51)}{Enter}`);
    await waitFor(() => {
      expect(screen.getByText(/50 characters or fewer/i)).toBeInTheDocument();
    });
    expect(tagsOf()).toBe("");
  });
});
