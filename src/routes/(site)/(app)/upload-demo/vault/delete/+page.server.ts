import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'

export const load: PageServerLoad = async ({ url }) => {
  const slot = url.searchParams.get('slot')?.trim() ?? ''
  const from = localPath(url.searchParams.get('from'))
  const backHref = from ?? '/upload-demo/vault'
  return { slot, backHref }
}
