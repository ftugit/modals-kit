// Входы с главной в сайтовые списки (S22): журнал сессий и глобальные
// блокировки.
//
// Право решает видимость, адрес берётся из реестра (`routes.ts`), а кнопка одна
// на два носителя: где есть модалка — `useModalLink` (с JS модалка, без JS тот
// же адрес), где модалки нет — прямая ссылка. Поэтому описание чистое: экран
// рисует компонент, а тест держит права и адреса без разметки.
import { checkGrants, grants } from '#core/lib/db/index.js'
import type { GrantSpec } from '#core/lib/db/index.js'
import { blocksListRoute, sessionsJournalRoute } from '../routes.js'
import { block as blockResource, session as sessionResource } from '../model/schema.js'

export type SiteListEntryKey = 'journal' | 'blocks'

export interface SiteListEntry {
  readonly key: SiteListEntryKey
  readonly title: string
  readonly text: string
  readonly cta: string
  /** Ключ модалки-носителя; `null` — только страница. */
  readonly modal: string | null
  /** Адрес из реестра маршрутов: он же fallback без JS. */
  readonly href: string
}

const ENTRIES: readonly (SiteListEntry & { readonly grants: GrantSpec })[] = [
  {
    key: 'journal',
    title: 'Журнал сессий',
    text: 'Все устройства сайта: кто вошёл, откуда и чем. Журнал виден кругу, который вправе читать чужие сессии.',
    cta: 'Открыть журнал',
    modal: 'user.sessions.journal',
    href: sessionsJournalRoute.href(),
    grants: grants(sessionResource).select,
  },
  {
    key: 'blocks',
    title: 'Блокировки',
    text: 'Глобальный список блокировок сайта: срез по срокам и областям, снятие и удаление набором.',
    cta: 'Открыть блокировки',
    modal: null,
    href: blocksListRoute.href(),
    grants: grants(blockResource).select,
  },
]

/**
 * Входы, доступные набору прав. Пустой набор прав и гость — пустой список:
 * карточка «нет права» на главной не нужна, о правах скажет сам экран.
 */
export function siteListEntries(permissions: readonly string[] | null | undefined): SiteListEntry[] {
  const perms = permissions ?? []
  const actor = { id: 'me', permissions: perms }
  return ENTRIES.filter((e) => checkGrants(actor, e.grants)).map(
    ({ grants: _grants, ...entry }) => entry,
  )
}
