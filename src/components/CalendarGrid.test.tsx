import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CalendarGrid } from "@/components/CalendarGrid";
import type { CalendarDay } from "@/types/api";

const MAY_2026: CalendarDay[] = [{ entry_date: "2026-05-10", count: 3 }];

describe("CalendarGrid", () => {
  it("renders the 7 weekday-label columns", () => {
    render(
      <CalendarGrid year={2026} month={5} daysWithEntries={[]} onDayClick={vi.fn()} />,
    );
    const grid = screen.getByTestId("calendar-grid");
    // The first grid row is the weekday header (7 single-letter labels).
    const header = grid.firstElementChild!;
    expect(header.children).toHaveLength(7);
  });

  it("renders a badge and a clickable button for a day with entries", async () => {
    const onDayClick = vi.fn();
    const user = userEvent.setup();
    render(
      <CalendarGrid
        year={2026}
        month={5}
        daysWithEntries={MAY_2026}
        today={new Date(2026, 4, 1)}
        onDayClick={onDayClick}
      />,
    );
    expect(screen.getByTestId("day-badge-2026-05-10")).toHaveTextContent("3");
    const cell = screen.getByTestId("day-2026-05-10");
    expect(cell.tagName).toBe("BUTTON");
    await user.click(cell);
    expect(onDayClick).toHaveBeenCalledWith("2026-05-10");
  });

  it("renders a non-clickable div for a day without entries", () => {
    render(
      <CalendarGrid
        year={2026}
        month={5}
        daysWithEntries={MAY_2026}
        today={new Date(2026, 4, 1)}
        onDayClick={vi.fn()}
      />,
    );
    const cell = screen.getByTestId("day-2026-05-11");
    expect(cell.tagName).toBe("DIV");
    expect(screen.queryByTestId("day-badge-2026-05-11")).not.toBeInTheDocument();
  });

  it("rings today's cell", () => {
    render(
      <CalendarGrid
        year={2026}
        month={5}
        daysWithEntries={[]}
        today={new Date(2026, 4, 15)}
        onDayClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("day-2026-05-15").className).toContain("ring-2");
  });

  it("handles leap years (Feb 2024 has the 29th; Feb 2025 does not)", () => {
    const { rerender } = render(
      <CalendarGrid year={2024} month={2} daysWithEntries={[]} onDayClick={vi.fn()} />,
    );
    expect(screen.getByTestId("day-2024-02-29")).toBeInTheDocument();

    rerender(
      <CalendarGrid year={2025} month={2} daysWithEntries={[]} onDayClick={vi.fn()} />,
    );
    // Feb 2025 has 28 days; the 29th never falls in-month.
    expect(screen.queryByTestId("day-2025-02-29")).not.toBeInTheDocument();
  });
});
