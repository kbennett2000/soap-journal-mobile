import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { makeEntriesInitializer, type SeedEntry } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// Entries on known dates within May 2026 so the grid is deterministic.
const SEED: SeedEntry[] = [
  { input: { scripture_ref: "John 1:1", entry_date: "2026-05-15" } },
  { input: { scripture_ref: "John 1:2", entry_date: "2026-05-15" } },
  { input: { scripture_ref: "Genesis 1:1", entry_date: "2026-05-20" } },
];

function renderCalendar(path = "/calendar?year=2026&month=5", seed = SEED) {
  return renderApp(<AppRoutes />, {
    initialEntries: [path],
    initialize: makeEntriesInitializer(seed),
  });
}

describe("CalendarPage", () => {
  it("renders per-day count badges for the month", async () => {
    renderCalendar();
    expect(await screen.findByTestId("day-badge-2026-05-15")).toHaveTextContent("2");
    expect(screen.getByTestId("day-badge-2026-05-20")).toHaveTextContent("1");
  });

  it("shows the month total in the footer", async () => {
    renderCalendar();
    expect(await screen.findByText("3 entries this month.")).toBeInTheDocument();
  });

  it("changes month via Next, updating the query and grid", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await screen.findByTestId("day-badge-2026-05-15");
    await user.click(screen.getByRole("button", { name: /Next month/ }));
    // June 2026 has no seeded entries.
    expect(await screen.findByText("June 2026")).toBeInTheDocument();
    expect(await screen.findByText("0 entries this month.")).toBeInTheDocument();
    expect(screen.queryByTestId("day-badge-2026-05-15")).not.toBeInTheDocument();
  });

  it("navigates to the date-filtered entry list when a day is clicked", async () => {
    const user = userEvent.setup();
    renderCalendar();
    await user.click(await screen.findByTestId("day-2026-05-15"));
    // Lands on the entry list filtered to that single day (2 entries).
    expect(await screen.findByRole("heading", { name: "Your entries" })).toBeInTheDocument();
    expect(await screen.findByText(/1–2 of 2/)).toBeInTheDocument();
  });
});
