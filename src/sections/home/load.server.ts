// Главная: входы в сайтовые списки считаются на сервере (S22).
//
// Право читается канонически (`checkGrants`), а разметка получает готовый
// список: иначе схема прав попадала бы в клиентский бандл главной.
import type { RequestEvent } from '@sveltejs/kit'
import { loadSiteListEntries } from '#modules/user/base/svelte/site-entries.server.js'

export async function loadHome(event: RequestEvent) {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  return { siteEntries: await loadSiteListEntries(event) }
}
