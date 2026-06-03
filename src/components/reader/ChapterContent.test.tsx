import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ChapterContent } from "@/components/reader/ChapterContent";
import type { ChapterResponse, FootnoteResponse } from "@/types/api";

// Renders the chapter under a router (FootnoteMarker's cross-ref chips are
// <Link>s) plus a probe that surfaces the current location for nav assertions.
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>;
}

function footnote(over: Partial<FootnoteResponse> & { id: number; text: string }): FootnoteResponse {
  return { note_type: null, char_offset: null, marker: null, ordinal: 0, cross_refs: [], ...over };
}

function chapterWith(footnotes: FootnoteResponse[]): ChapterResponse {
  return {
    translation_code: "NET",
    book: { name: "Genesis", abbreviation: "Gen", order_index: 1, testament: "OT", chapter_count: 50 },
    chapter_number: 1,
    verses: [{ id: 1, number: 1, text: "In the beginning", is_red_letter: false, footnotes }],
    headings: [],
    previous: null,
    next: null,
  };
}

function renderChapter(chapter: ChapterResponse) {
  return render(
    <MemoryRouter initialEntries={["/read/NET/Genesis/1"]}>
      <ChapterContent chapter={chapter} layout="verse" fontSize="M" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("ChapterContent — footnote notes & cross-refs", () => {
  it("opens a typed note showing its type label and text", async () => {
    const user = userEvent.setup();
    renderChapter(chapterWith([footnote({ id: 1, text: "tn body", note_type: "tn" })]));

    expect(screen.queryByTestId("note-type")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Footnote" }));

    const note = screen.getByRole("note");
    expect(within(note).getByTestId("note-type")).toHaveTextContent("Translator's Note");
    expect(within(note).getByText("tn body")).toBeInTheDocument();
  });

  it("renders cross-ref chips with labels + URLs and navigates on click", async () => {
    const user = userEvent.setup();
    renderChapter(
      chapterWith([
        footnote({
          id: 1,
          text: "tn body",
          note_type: "tn",
          cross_refs: [
            { to_book: "John", to_chapter: 1, to_verse_start: 1, to_verse_end: null },
            { to_book: "Ps", to_chapter: 33, to_verse_start: 6, to_verse_end: 9 },
          ],
        }),
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Footnote" }));

    const single = screen.getByRole("link", { name: "John 1:1" });
    expect(single).toHaveAttribute("href", "/read/NET/John/1?range=1-1");
    // A range cross-ref labels start-end and ranges the URL accordingly.
    expect(screen.getByRole("link", { name: "Ps 33:6-9" })).toHaveAttribute(
      "href",
      "/read/NET/Ps/33?range=6-9",
    );

    await user.click(single);
    expect(screen.getByTestId("loc")).toHaveTextContent("/read/NET/John/1?range=1-1");
  });

  it("renders a plain footnote as text only — no type label, no chips", async () => {
    const user = userEvent.setup();
    renderChapter(chapterWith([footnote({ id: 1, text: "a plain footnote" })]));
    await user.click(screen.getByRole("button", { name: "Footnote" }));

    const note = screen.getByRole("note");
    expect(within(note).getByText("a plain footnote")).toBeInTheDocument();
    expect(within(note).queryByTestId("note-type")).not.toBeInTheDocument();
    expect(within(note).queryByRole("link")).not.toBeInTheDocument();
  });
});
