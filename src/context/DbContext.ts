import { createContext } from 'react'

import type { DbExecutor } from '@/lib/db/executor'

/**
 * Holds the ready `DbExecutor`. Null until `DbProvider` finishes initializing;
 * consumers reach it through `useDb()` (which only ever sees a ready value,
 * since the provider renders its children only once initialization succeeds).
 *
 * Kept in its own value-only module so the provider component and the `useDb`
 * hook can live in separate files (react-refresh / fast-refresh friendliness).
 */
export const DbContext = createContext<DbExecutor | null>(null)
