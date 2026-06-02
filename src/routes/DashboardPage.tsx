import { useQuery } from '@tanstack/react-query'

import { useDb } from '@/hooks/useDb'
import { listTranslations } from '@/lib/db/bible'

/**
 * Stub — replaced in a later feature cycle. For now it surfaces a live count of
 * loaded translations, which doubles as the on-device proof that the executor
 * reads the copied database (see cycle 10).
 */
export function DashboardPage(): JSX.Element {
  const db = useDb()
  const query = useQuery({
    queryKey: ['bible', 'translations'],
    queryFn: () => listTranslations(db),
  })

  let status: string
  if (query.isPending) {
    status = 'Loading translations…'
  } else if (query.isError) {
    status = 'Could not read the database.'
  } else {
    const count = query.data.translations.length
    status = `${count} ${count === 1 ? 'translation' : 'translations'} available`
  }

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">{status}</p>
    </section>
  )
}
