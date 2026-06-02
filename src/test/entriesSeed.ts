import { ALL_BOOKS } from "@/lib/bible/books";
import { createBetterSqliteExecutor } from "@/lib/db/betterSqliteConnection";
import { saveEntry } from "@/lib/db/entries";
import type { DbExecutor } from "@/lib/db/executor";
import { loadTranslation } from "@/lib/db/loadTranslation";
import { runMigrations } from "@/lib/db/migrations";
import { CanonicalTranslationSchema } from "@/lib/schema/canonical";
import type { EntryCreateRequest } from "@/types/api";

// A synthetic translation with enough verses for the entry-seed references.
const OVERRIDES: Record<string, { number: number; text: string }[]> = {
  Genesis: [1, 2, 3, 4, 5].map((n) => ({ number: n, text: `Gen 1:${n}` })),
  John: [1, 2, 3].map((n) => ({ number: n, text: `John 1:${n}` })),
};

function buildTranslation() {
  const books = ALL_BOOKS.map((spec) => ({
    name: spec.name,
    abbreviation: spec.abbreviation,
    order_index: spec.order_index,
    chapters: [{ number: 1, verses: OVERRIDES[spec.name] ?? [{ number: 1, text: `${spec.name} 1:1` }] }],
  }));
  return CanonicalTranslationSchema.parse({
    code: "TST",
    name: "Test Translation",
    language: "en",
    copyright: "© test",
    books,
  });
}

export interface SeedEntry {
  input: EntryCreateRequest;
  /** Pinned created_at/updated_at (and default entry_date) for deterministic ordering. */
  now?: string;
}

/**
 * Build a DbProvider initializer that migrates a fresh in-memory DB, loads the
 * synthetic translation, and creates the seed entries through the REAL
 * `saveEntry` path (so the data is realistic — no direct row inserts).
 */
export function makeEntriesInitializer(seed: SeedEntry[] = []): () => Promise<DbExecutor> {
  return async () => {
    const db = createBetterSqliteExecutor(":memory:");
    await runMigrations(db);
    await loadTranslation(db, buildTranslation());
    let i = 0;
    for (const s of seed) {
      i += 1;
      const now = s.now ?? `2026-06-02T12:00:${String(i).padStart(2, "0")}.000Z`;
      await saveEntry(db, s.input, undefined, now);
    }
    return db;
  };
}

export interface CapturingInitializer {
  /** Pass to `renderApp({ initialize })`. */
  initialize: () => Promise<DbExecutor>;
  /** The executor created by the most recent `initialize()` call (post-render). */
  db: () => DbExecutor;
}

/**
 * Like `makeEntriesInitializer`, but also exposes the created executor so a
 * test can round-trip: drive the form UI, then assert via the REAL
 * `getEntry`/`listEntries` repositories against the same DB.
 */
export function makeCapturingEntriesInitializer(
  seed: SeedEntry[] = [],
): CapturingInitializer {
  let captured: DbExecutor | null = null;
  const initialize = async (): Promise<DbExecutor> => {
    const db = createBetterSqliteExecutor(":memory:");
    await runMigrations(db);
    await loadTranslation(db, buildTranslation());
    let i = 0;
    for (const s of seed) {
      i += 1;
      const now = s.now ?? `2026-06-02T12:00:${String(i).padStart(2, "0")}.000Z`;
      await saveEntry(db, s.input, undefined, now);
    }
    captured = db;
    return db;
  };
  return {
    initialize,
    db: () => {
      if (!captured) throw new Error("initializer has not run yet");
      return captured;
    },
  };
}

/** A small, varied seed across John/Romans/Psalms; tags faith/grace/family. */
export const DEFAULT_SEED: SeedEntry[] = [
  {
    input: {
      scripture_ref: "John 1:1",
      title: "Love defined",
      observation: "God so loved.",
      tags: ["faith", "grace"],
      entry_date: "2026-05-26",
    },
  },
  {
    input: {
      scripture_ref: "John 1:2",
      observation: "Not condemnation.",
      application: "Trust Him.",
      tags: ["faith"],
      entry_date: "2026-05-20",
    },
  },
  {
    input: {
      scripture_ref: "Romans 1:1",
      title: "Working for good",
      prayer: "help me trust the love at work.",
      tags: ["faith", "family"],
      entry_date: "2025-08-15",
    },
  },
  {
    input: {
      scripture_ref: "Psalm 1:1",
      observation: "Shepherd imagery.",
      tags: ["family"],
      entry_date: "2024-12-25",
    },
  },
  {
    input: {
      scripture_ref: "John 1:1",
      title: "The Word",
      observation: "In the beginning.",
      tags: ["grace"],
      entry_date: "2024-05-26",
    },
  },
];
