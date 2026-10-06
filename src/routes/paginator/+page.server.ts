import type { PageServerLoad } from './$types'
import { loadPaginatorDemo } from '../../features/paginator/loader'

export const load: PageServerLoad = async ({ url }) => {
  const loaderData = await loadPaginatorDemo({ url })
  return { loaderData }
}
