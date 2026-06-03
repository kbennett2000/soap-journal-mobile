import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { isOmittedVerse } from "@/lib/bibleText";
import { buildVerseParts } from "@/lib/verseSegments";
import type { FontSize, ReaderLayout } from "@/lib/storage";
import type {
  ChapterResponse,
  CrossRefResponse,
  FootnoteResponse,
  HeadingResponse,
  NoteType,
  VerseResponse,
} from "@/types/api";

/** Display labels for typed translator's notes (mirrors the server). */
const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  tn: "Translator's Note",
  sn: "Study Note",
  tc: "Text-Critical Note",
  map: "Map",
};

/** "Book ch:start" or "Book ch:start-end" (mirrors the server's crossRefLabel). */
function crossRefLabel(xr: CrossRefResponse): string {
  const base = `${xr.to_book} ${xr.to_chapter}:${xr.to_verse_start}`;
  return xr.to_verse_end ? `${base}-${xr.to_verse_end}` : base;
}

/**
 * Target reader URL for a cross-ref (mirrors the server's crossRefUrl). `to_book`
 * is the target's abbreviation — a "navigable alias" that `getChapter` resolves
 * to the canonical book via `getBookByName`. `?range` is always set.
 */
function crossRefUrl(translationCode: string, xr: CrossRefResponse): string {
  const end = xr.to_verse_end ?? xr.to_verse_start;
  return (
    `/read/${encodeURIComponent(translationCode)}` +
    `/${encodeURIComponent(xr.to_book)}/${xr.to_chapter}` +
    `?range=${xr.to_verse_start}-${end}`
  );
}

const FONT_SIZE_CLASS: Record<FontSize, string> = {
  S: "text-sm leading-7",
  M: "text-base leading-8",
  L: "text-lg leading-9",
};

interface ChapterContentProps {
  chapter: ChapterResponse;
  layout: ReaderLayout;
  fontSize: FontSize;
  highlightRange?: { start: number; end: number };
  // Optional: when provided, verses are clickable (e.g. to create an entry).
  // Until the entries feature lands, the reader is read-only and omits it, so
  // verses render as non-interactive text.
  onVerseClick?: (verse: VerseResponse) => void;
}

export function ChapterContent({
  chapter,
  layout,
  fontSize,
  highlightRange,
  onVerseClick,
}: ChapterContentProps): JSX.Element {
  // Group headings by the verse number they precede so renderers can
  // emit them inline at the right spot.
  const headingsByVerse = new Map<number, HeadingResponse[]>();
  for (const h of chapter.headings) {
    const list = headingsByVerse.get(h.before_verse) ?? [];
    list.push(h);
    headingsByVerse.set(h.before_verse, list);
  }

  const sizeClass = FONT_SIZE_CLASS[fontSize];
  const verseRef = useScrollToFirstHighlight(highlightRange?.start);

  // Exactly one note is open at a time; tapping a marker (inline typed or
  // end-of-verse plain) opens THAT note in an in-flow NoteView next to its verse
  // (replaces the old absolute popover that clipped off-screen).
  const [openNote, setOpenNote] = useState<FootnoteResponse | null>(null);

  const layoutProps: LayoutProps = {
    chapter,
    headingsByVerse,
    highlightRange,
    verseRef,
    onVerseClick,
    openNote,
    onNoteClick: setOpenNote,
    onCloseNote: () => setOpenNote(null),
  };

  return (
    <article
      data-testid="chapter-content"
      className={`prose prose-slate max-w-none break-words dark:prose-invert ${sizeClass}`}
    >
      <h1 className="!mb-2 !mt-0 text-2xl font-semibold">
        {chapter.book.name} {chapter.chapter_number}
      </h1>
      {layout === "verse" ? (
        <VerseLayout {...layoutProps} />
      ) : (
        <ParagraphLayout {...layoutProps} />
      )}
    </article>
  );
}

// ---- helpers --------------------------------------------------------------

function useScrollToFirstHighlight(
  startVerse: number | undefined,
): (el: HTMLElement | null) => void {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (startVerse === undefined) return;
    if (ref.current) {
      ref.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [startVerse]);
  return (el) => {
    ref.current = el;
  };
}

function inHighlight(
  verseNumber: number,
  range: { start: number; end: number } | undefined,
): boolean {
  if (!range) return false;
  return verseNumber >= range.start && verseNumber <= range.end;
}

function verseClassNames(
  verse: VerseResponse,
  highlighted: boolean,
  interactive: boolean,
): string {
  const base = "rounded text-left transition-colors";
  const click = interactive
    ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
    : "";
  const omitted = isOmittedVerse(verse)
    ? "italic text-slate-400 dark:text-slate-500"
    : "";
  const red = verse.is_red_letter ? "text-rose-700 dark:text-rose-300" : "";
  const hi = highlighted ? "bg-amber-100 dark:bg-amber-900/40" : "";
  return [base, click, omitted, red, hi].filter(Boolean).join(" ");
}

interface HeadingProps {
  heading: HeadingResponse;
}

function Heading({ heading }: HeadingProps): JSX.Element {
  return (
    <h2 className="!mb-2 !mt-6 text-lg font-semibold text-slate-700 dark:text-slate-200">
      {heading.text}
    </h2>
  );
}

/** Inline marker for a typed note (anchored at its char_offset), showing its number. */
function NoteMarker({
  number,
  onClick,
}: {
  number: number;
  onClick: (event: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="note-marker"
      aria-label={`Note ${number}`}
      onClick={onClick}
      className="mx-0.5 align-super text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
    >
      {number}
    </button>
  );
}

/** End-of-verse marker for a plain footnote (char_offset === null). */
function PlainFootnoteMarker({
  onClick,
}: {
  onClick: (event: React.MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label="Footnote"
      onClick={onClick}
      className="mx-0.5 align-super text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      ⁿ
    </button>
  );
}

/**
 * A verse's body: text runs with inline typed-note markers at their offsets,
 * then an end-of-verse marker per plain footnote. Both kinds open their note via
 * `onNoteClick` (stopPropagation so a marker tap doesn't fire the verse's own
 * onVerseClick).
 */
function VerseText({
  verse,
  onNoteClick,
}: {
  verse: VerseResponse;
  onNoteClick: (note: FootnoteResponse) => void;
}): JSX.Element {
  const parts = buildVerseParts(verse.text, verse.footnotes);
  const plain = verse.footnotes.filter((f) => f.char_offset === null);
  return (
    <>
      {parts.map((part, i) =>
        part.type === "marker" ? (
          <NoteMarker
            key={`m-${part.note.id}`}
            number={part.number}
            onClick={(e) => {
              e.stopPropagation();
              onNoteClick(part.note);
            }}
          />
        ) : (
          <span key={`t-${i}`}>{part.text}</span>
        ),
      )}
      {plain.map((f) => (
        <PlainFootnoteMarker
          key={`p-${f.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onNoteClick(f);
          }}
        />
      ))}
    </>
  );
}

/**
 * The opened note, rendered in-flow (a full-width block adjacent to its verse)
 * so it can't clip off-screen. Type label (when typed), text, and cross-ref
 * chips that navigate; a close affordance.
 */
function NoteView({
  note,
  translationCode,
  onClose,
}: {
  note: FootnoteResponse;
  translationCode: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <aside
      role="note"
      data-testid="note-view"
      className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-1 flex items-start gap-2">
        {note.note_type && (
          <span
            data-testid="note-type"
            className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
          >
            {NOTE_TYPE_LABELS[note.note_type]}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close note"
          className="ml-auto text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          ×
        </button>
      </div>
      <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{note.text}</p>
      {note.cross_refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {note.cross_refs.map((xr, i) => (
            <Link
              key={`${xr.to_book}-${xr.to_chapter}-${xr.to_verse_start}-${i}`}
              to={crossRefUrl(translationCode, xr)}
              onClick={(e) => e.stopPropagation()}
              className="rounded border border-sky-200 bg-white px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300"
            >
              {crossRefLabel(xr)}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

// ---- layouts --------------------------------------------------------------

interface LayoutProps {
  chapter: ChapterResponse;
  headingsByVerse: Map<number, HeadingResponse[]>;
  highlightRange?: { start: number; end: number };
  verseRef: (el: HTMLElement | null) => void;
  onVerseClick?: (verse: VerseResponse) => void;
  openNote: FootnoteResponse | null;
  onNoteClick: (note: FootnoteResponse) => void;
  onCloseNote: () => void;
}

/** True when `openNote` is one of this verse's footnotes. */
function verseOwnsNote(verse: VerseResponse, openNote: FootnoteResponse | null): boolean {
  return openNote !== null && verse.footnotes.some((f) => f.id === openNote.id);
}

function VerseLayout({
  chapter,
  headingsByVerse,
  highlightRange,
  verseRef,
  onVerseClick,
  openNote,
  onNoteClick,
  onCloseNote,
}: LayoutProps): JSX.Element {
  return (
    <div className="space-y-1">
      {chapter.verses.map((verse) => {
        const headings = headingsByVerse.get(verse.number) ?? [];
        const highlighted = inHighlight(verse.number, highlightRange);
        const isStart = highlightRange?.start === verse.number;
        const className = `block w-full px-2 py-1 ${verseClassNames(
          verse,
          highlighted,
          onVerseClick !== undefined,
        )}`;
        const inner = (
          <>
            <span className="mr-2 inline-block min-w-[1.5rem] text-right font-semibold text-slate-400 dark:text-slate-500">
              {verse.number}
            </span>
            <VerseText verse={verse} onNoteClick={onNoteClick} />
          </>
        );
        return (
          <div key={verse.id}>
            {headings.map((h) => (
              <Heading key={`${h.before_verse}-${h.text}`} heading={h} />
            ))}
            {onVerseClick ? (
              <button
                type="button"
                ref={isStart ? verseRef : undefined}
                onClick={() => onVerseClick(verse)}
                data-testid={`verse-${verse.number}`}
                className={className}
              >
                {inner}
              </button>
            ) : (
              <div
                ref={isStart ? verseRef : undefined}
                data-testid={`verse-${verse.number}`}
                className={className}
              >
                {inner}
              </div>
            )}
            {verseOwnsNote(verse, openNote) && (
              <NoteView
                note={openNote!}
                translationCode={chapter.translation_code}
                onClose={onCloseNote}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ParagraphLayout({
  chapter,
  headingsByVerse,
  highlightRange,
  verseRef,
  onVerseClick,
  openNote,
  onNoteClick,
  onCloseNote,
}: LayoutProps): JSX.Element {
  // Walk the chapter in order, emitting <h2> blocks where a heading
  // precedes a verse and accumulating verses into a running <p> in
  // between. Headings break the current paragraph so the page reads as
  // alternating prose paragraphs and section breaks.
  const nodes: React.ReactNode[] = [];
  let buffer: React.ReactNode[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    nodes.push(
      <p key={`p${nodes.length}`} className="leading-9">
        {buffer}
      </p>,
    );
    buffer = [];
  };

  for (const verse of chapter.verses) {
    const headings = headingsByVerse.get(verse.number) ?? [];
    if (headings.length) {
      flush();
      for (const h of headings) {
        nodes.push(<Heading key={`h${nodes.length}-${verse.number}`} heading={h} />);
      }
    }
    const highlighted = inHighlight(verse.number, highlightRange);
    const isStart = highlightRange?.start === verse.number;
    const className = `inline ${verseClassNames(
      verse,
      highlighted,
      onVerseClick !== undefined,
    )} px-1`;
    const inner = (
      <>
        <sup className="mr-1 font-semibold text-slate-400 dark:text-slate-500">
          {verse.number}
        </sup>
        <VerseText verse={verse} onNoteClick={onNoteClick} />
      </>
    );
    buffer.push(
      onVerseClick ? (
        <button
          key={verse.id}
          type="button"
          ref={isStart ? verseRef : undefined}
          onClick={() => onVerseClick(verse)}
          data-testid={`verse-${verse.number}`}
          className={className}
        >
          {inner}
        </button>
      ) : (
        <span
          key={verse.id}
          ref={isStart ? verseRef : undefined}
          data-testid={`verse-${verse.number}`}
          className={className}
        >
          {inner}
        </span>
      ),
    );
    buffer.push(" ");

    // An open note breaks the paragraph so its block NoteView can sit right
    // after the verse (block asides can't live inside a <p>).
    if (verseOwnsNote(verse, openNote)) {
      flush();
      nodes.push(
        <NoteView
          key={`note-${openNote!.id}`}
          note={openNote!}
          translationCode={chapter.translation_code}
          onClose={onCloseNote}
        />,
      );
    }
  }
  flush();

  return <div className="space-y-2">{nodes}</div>;
}
