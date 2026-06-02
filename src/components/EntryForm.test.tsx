import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EntryForm, type EntryFormValues } from "@/components/EntryForm";
import { ApiError } from "@/lib/db/errors";
import { ErrorCode } from "@/lib/db/errors";
import { makeEntriesInitializer } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

const BASE: EntryFormValues = {
  title: "",
  entryDate: "2026-05-26",
  scriptureRef: "Genesis 1:1",
  translationCode: "TST",
  observation: "obs text",
  application: "app text",
  prayer: "pray text",
  tags: ["faith"],
};

function renderForm(
  props: Partial<Parameters<typeof EntryForm>[0]> = {},
  initialValues: EntryFormValues = BASE,
) {
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  renderApp(
    <EntryForm
      initialValues={initialValues}
      onSubmit={onSubmit}
      submitLabel="Create entry"
      {...props}
    />,
    { initialize: makeEntriesInitializer([]) },
  );
  return onSubmit;
}

describe("EntryForm", () => {
  it("renders all fields from initialValues", async () => {
    renderForm();
    expect(await screen.findByLabelText("Date")).toHaveValue("2026-05-26");
    expect(screen.getByLabelText("Scripture reference")).toHaveValue("Genesis 1:1");
    expect(screen.getByLabelText("Observation")).toHaveValue("obs text");
    expect(screen.getByLabelText("Application")).toHaveValue("app text");
    expect(screen.getByLabelText("Prayer")).toHaveValue("pray text");
    expect(screen.getByText("faith")).toBeInTheDocument();
  });

  it("calls onSubmit with the current values (empty title preserved as \"\")", async () => {
    const user = userEvent.setup();
    const onSubmit = renderForm();
    await screen.findByLabelText("Scripture reference");
    await user.click(screen.getByRole("button", { name: "Create entry" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "", scriptureRef: "Genesis 1:1" }));
  });

  it("surfaces a reference ApiError and focuses the ref input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(400, ErrorCode.INVALID_REFERENCE, "Invalid reference."));
    renderForm({ onSubmit });
    await screen.findByLabelText("Scripture reference");
    await user.click(screen.getByRole("button", { name: "Create entry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid reference.");
    expect(screen.getByLabelText("Scripture reference")).toHaveFocus();
  });

  it("shows the Delete button only when onDelete is provided, gated behind the dialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderForm({ onDelete });
    await screen.findByLabelText("Scripture reference");
    // Opens the confirm dialog rather than deleting immediately.
    await user.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });

  it("omits the Delete button without onDelete", async () => {
    renderForm();
    await screen.findByLabelText("Scripture reference");
    expect(screen.queryByRole("button", { name: "Delete entry" })).not.toBeInTheDocument();
  });
});
