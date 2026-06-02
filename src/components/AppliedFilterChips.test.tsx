import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppliedFilterChips } from "@/components/AppliedFilterChips";

describe("AppliedFilterChips", () => {
  it("renders nothing when no filters are applied", () => {
    const { container } = render(
      <AppliedFilterChips
        applied={{ q: null, book: null, tag: null, from_date: null, to_date: null }}
        onRemove={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per non-null filter", () => {
    render(
      <AppliedFilterChips
        applied={{
          q: "love",
          book: "John",
          tag: "faith",
          from_date: "2026-01-01",
          to_date: "2026-12-31",
        }}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText("love")).toBeInTheDocument();
    expect(screen.getByText("John")).toBeInTheDocument();
    expect(screen.getByText("faith")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
    expect(screen.getByText("2026-12-31")).toBeInTheDocument();
  });

  it("clicking × on a chip calls onRemove with that filter key", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <AppliedFilterChips
        applied={{ q: "love", book: null, tag: "faith", from_date: null, to_date: null }}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getByRole("button", { name: /remove tag filter/i }));
    expect(onRemove).toHaveBeenCalledWith("tag");
  });
});
