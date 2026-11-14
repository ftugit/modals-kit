// Серверная сборка входов с главной (S22).
//
// Права считает чистое описание (`site-entries.ts`) — это канонический
// `checkGrants`, а не список строк в разметке. Загрузчик главной отдаёт готовые
// карточки числами и адресами: клиентский бандл главной не тянет схему прав.
import type { RequestEvent } from '@sveltejs/kit'
import { auth } from '../gateway.server.js'
import { siteListEntries, type SiteListEntry } from './site-entries.js'

/** Входы, доступные текущему зрителю. Гость и отказ — пустой список. */
export async function loadSiteListEntries(event: RequestEvent): Promise<SiteListEntry[]> {
  const u = auth(event)
  if (!u.enabled) return []
  const actor = await u.actor()
  if (!actor.ok) return []
  return siteListEntries(actor.value.permissions)
}
