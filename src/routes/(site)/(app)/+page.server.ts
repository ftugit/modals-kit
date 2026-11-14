// Главная: входы в сайтовые списки считаются на сервере (S22).
//
// Право читается канонически (`checkGrants`), а разметка получает готовый
// список: иначе схема прав попадала бы в клиентский бандл главной.
import type { PageServerLoad } from './$types'
import { loadSiteListEntries } from '#content/user/ui/site-entries.server.js'

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  return { siteEntries: await loadSiteListEntries(event) }
}
