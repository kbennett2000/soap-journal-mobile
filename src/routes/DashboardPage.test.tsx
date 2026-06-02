import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AppRoutes } from "@/AppRoutes";
import { makeEntriesInitializer, type SeedEntry } from "@/test/entriesSeed";
import { renderApp } from "@/test/renderApp";

// On-this-day matches today's month-day across prior years (onThisDay defaults
// its reference date to today). Compute today's MM-DD at test time so the
// fixture is robust to the run date.
const today = new Date();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const priorYear = today.getFullYear() - 1;
// A clearly different month so the "recent" entry never lands on today's MM-DD.
const otherMonth = String(((today.getMonth() + 6) % 12) + 1).padStart(2, "0");

const RICH: SeedEntry[] = [
  {
    input: {
      scripture_ref: "John 1:1",
      title: "Recent note",
      entry_date: `${today.getFullYear()}-${otherMonth}-15`,
    },
  },
  {
    input: {
      scripture_ref: "John 1:2",
      title: "Anniversary note",
      entry_date: `${priorYear}-${mm}-${dd}`,
    },
  },
];

function renderDashboard(seed: SeedEntry[] = RICH) {
  return renderApp(<AppRoutes />, {
    initialEntries: ["/"],
    initialize: makeEntriesInitializer(seed),
  });
}

// Await the region (also waits past the DbProvider "Loading…" gate); scoping by
// region matters because on-this-day entries also appear in the recent list.
const recentRegion = () =>
  screen.findByRole("region", { name: "Recent entries" });
const onThisDayRegion = () =>
  screen.findByRole("region", { name: "On this day in previous years" });

describe("DashboardPage", () => {
  it("renders the recent entries", async () => {
    renderDashboard();
    expect(await within(await recentRegion()).findByText("Recent note")).toBeInTheDocument();
  });

  it("shows the recent empty state when there are no entries", async () => {
    renderDashboard([]);
    expect(await screen.findByTestId("dash-recent-empty")).toBeInTheDocument();
  });

  it("renders on-this-day entries from prior years, year-first", async () => {
    renderDashboard();
    const region = await onThisDayRegion();
    expect(await within(region).findByText("Anniversary note")).toBeInTheDocument();
    // CompactEntryCard showYear renders the year prominently.
    expect(within(region).getByText(new RegExp(String(priorYear)))).toBeInTheDocument();
  });

  it("shows the on-this-day empty state when nothing matches", async () => {
    // Only a recent entry on a non-today month-day → on-this-day is empty.
    renderDashboard([RICH[0]!]);
    expect(await screen.findByTestId("dash-onthisday-empty")).toBeInTheDocument();
  });

  it("jumps to a valid passage and navigates to the reader", async () => {
    const user = userEvent.setup();
    renderDashboard([]);
    // Gate on the page being ready (translations loaded) before submitting.
    await screen.findByTestId("dash-recent-empty");
    await user.type(screen.getByRole("textbox", { name: /jump to reference/i }), "John 1:1");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("heading", { name: "John 1" })).toBeInTheDocument();
  });

  it("surfaces the ApiError for an invalid reference without navigating", async () => {
    const user = userEvent.setup();
    renderDashboard([]);
    await screen.findByTestId("dash-recent-empty");
    await user.type(screen.getByRole("textbox", { name: /jump to reference/i }), "Frodo 3:16");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/unknown book/i);
    // Still on the dashboard.
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("links the new-entry CTA to /entries/new", async () => {
    renderDashboard();
    expect(await screen.findByRole("link", { name: "+ New entry" })).toHaveAttribute(
      "href",
      "/entries/new",
    );
  });
});
