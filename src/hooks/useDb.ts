import { useContext } from 'react'

import { DbContext } from '@/context/DbContext'
import type { DbExecutor } from '@/lib/db/executor'

/**
 * Access the ready `DbExecutor`. Safe to call in any component rendered inside
 * `DbProvider` once it's ready (the provider gates its children on readiness),
 * so the returned value is always non-null. Throws if used outside the provider.
 */
export function useDb(): DbExecutor {
  const executor = useContext(DbContext)
  if (executor === null) {
    throw new Error('useDb must be used within a ready DbProvider')
  }
  return executor
}
