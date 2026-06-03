import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { isOmittedVerse } from "@/lib/bibleText";
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

  return (
    <article
      data-testid="chapter-content"
      className={`prose prose-slate max-w-none break-words dark:prose-invert ${sizeClass}`}
    >
      <h1 className="!mb-2 !mt-0 text-2xl font-semibold">
        {chapter.book.name} {chapter.chapter_number}
      </h1>
      {layout === "verse" ? (
        <VerseLayout
          chapter={chapter}
          headingsByVerse={headingsByVerse}
          highlightRange={highlightRange}
          verseRef={verseRef}
          onVerseClick={onVerseClick}
        />
      ) : (
        <ParagraphLayout
          chapter={chapter}
          headingsByVerse={headingsByVerse}
          highlightRange={highlightRange}
          verseRef={verseRef}
          onVerseClick={onVerseClick}
        />
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

interface FootnoteMarkerProps {
  footnotes: FootnoteResponse[];
  translationCode: string;
}

function FootnoteMarker({ footnotes, translationCode }: FootnoteMarkerProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (footnotes.length === 0) return null;
  return (
    <span className="relative inline-block align-super text-xs">
      <button
        type="button"
        aria-label="Footnote"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        ⁿ
      </button>
      {open && (
        <span
          role="note"
          className="absolute left-1/2 z-10 mt-1 w-64 -translate-x-1/2 space-y-2 rounded border border-slate-200 bg-white p-2 text-left text-xs text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {footnotes.map((f) => (
            <span key={f.id} className="block">
              {f.note_type && (
                <span
                  data-testid="note-type"
                  className="mb-0.5 block font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
                >
                  {NOTE_TYPE_LABELS[f.note_type]}
                </span>
              )}
              <span className="block whitespace-pre-wrap">{f.text}</span>
              {f.cross_refs.length > 0 && (
                <span className="mt-1 flex flex-wrap gap-1">
                  {f.cross_refs.map((xr, i) => (
                    <Link
                      key={`${xr.to_book}-${xr.to_chapter}-${xr.to_verse_start}-${i}`}
                      to={crossRefUrl(translationCode, xr)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border border-sky-200 bg-white px-2 py-0.5 text-sky-700 hover:bg-sky-50 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300"
                    >
                      {crossRefLabel(xr)}
                    </Link>
                  ))}
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// ---- layouts --------------------------------------------------------------

interface LayoutProps {
  chapter: ChapterResponse;
  headingsByVerse: Map<number, HeadingResponse[]>;
  highlightRange?: { start: number; end: number };
  verseRef: (el: HTMLElement | null) => void;
  onVerseClick?: (verse: VerseResponse) => void;
}

function VerseLayout({
  chapter,
  headingsByVerse,
  highlightRange,
  verseRef,
  onVerseClick,
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
            <span>{verse.text}</span>
            <FootnoteMarker
              footnotes={verse.footnotes}
              translationCode={chapter.translation_code}
            />
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
        <span>{verse.text}</span>
        <FootnoteMarker
          footnotes={verse.footnotes}
          translationCode={chapter.translation_code}
        />
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
  }
  flush();

  return <div className="space-y-2">{nodes}</div>;
}
